use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;

use scraper::{Html, Selector};
use url::Url;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024; // 下载上限 2MB，防内存炸弹
const MAX_RESULT_CHARS: usize = 50_000; // 返回内容截断上限

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Fetch and extract readable text content from a URL.
/// 无 API 依赖：本地抓取 + Readability 提取正文 + 转 Markdown。
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<String, String> {
    let html = fetch_page(&url).await?;

    // Readability 提取正文（自动剔除导航/广告/页脚）
    let parsed_url = Url::parse(&url).map_err(|e| format!("URL 解析失败: {}", e))?;
    let mut cursor = std::io::Cursor::new(html.as_bytes());
    let product = readability::extractor::extract(&mut cursor, &parsed_url)
        .map_err(|e| format!("正文提取失败: {}", e))?;
    let content_html = product.content;

    if content_html.trim().chars().count() >= 100 {
        let md = mdka::html_to_markdown(&content_html);
        let mut result = String::new();
        let title = product.title.trim();
        if !title.is_empty() {
            result.push_str(&format!("# {}\n\n", title));
        }
        result.push_str(md.trim());
        return Ok(truncate_chars(&result, MAX_RESULT_CHARS));
    }

    // 提取失败（JS 页面 / 内容过短）→ 回退到简单的标签剥离
    let clean = strip_html(&remove_scripts_and_styles(&html));
    let text: String = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() < 50 {
        Err("页面内容过短，可能是需要 JavaScript 的动态页面".to_string())
    } else {
        Ok(truncate_chars(&text, MAX_RESULT_CHARS))
    }
}

/// Web search。搜索源优先级：Tavily（配置 API Key 时）→ SearXNG（可选）→ Bing RSS → DuckDuckGo HTML。
/// 每个源的结果都会经过相关性过滤，跑题结果（如 Bing 对中文查询的降级兜底）会被丢弃并降级到下一源。
/// Tavily 可配置：设置面板的 Tavily API Key，或环境变量 WORLDFORGE_TAVILY_API_KEY。
/// SearXNG 可配置：设置面板的 SearXNG URL，或环境变量 WORLDFORGE_SEARXNG_URL（需开启 JSON API）。
#[tauri::command]
pub async fn web_search(query: String, count: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let limit = count.unwrap_or(5).min(10);

    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(SEARCH_TIMEOUT)
        .redirect(build_redirect_policy())
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    // 0) Tavily 优先：配置了 API Key 就用（专门为 LLM agent 设计的搜索 API，结果精准）。
    //    失败或未配置时降级到 SearXNG → 免费链。
    if let Some(key) = tavily_api_key() {
        if let Some(results) = tavily_search(&key, &query, limit).await {
            return Ok(results);
        }
    }

    // 1) 配置了 SearXNG 实例时使用（自建实例最可靠，结果质量由部署方掌控）；
    //    失败或未配置时降级到免费链。
    if let Some(base) = searxng_base_url() {
        if let Some(results) = searxng_search(&base, &query, limit).await {
            return Ok(results);
        }
    }

    // 2) Bing RSS：先预热 cookie 会话（匿名 RSS 请求会被降级），中文查询加 mkt=zh-CN。
    //    多词中文查询易被 Bing 退化成只匹配部分关键词，跑题时按查询变体（去修饰词）重试。
    let cookie = warmup_bing_cookie(&client).await;
    let cookie_str: &str = cookie.as_deref().unwrap_or("");
    for variant in query_variants(&query) {
        for host in ["www.bing.com", "cn.bing.com"] {
            if let Some(results) = bing_search(&client, host, &variant, cookie_str, limit).await {
                return Ok(results);
            }
        }
    }

    // 3) DuckDuckGo HTML：部分网络环境可用
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let ddg_url = format!("https://html.duckduckgo.com/html/?q={}", encoded);
    if let Ok(resp) = client.get(&ddg_url).send().await {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let lower = html.to_ascii_lowercase();
                if !(lower.contains("anomaly")
                    || lower.contains("challenge")
                    || lower.contains("are you a human"))
                {
                    let results = parse_ddg_results(&html, limit);
                    let relevant = filter_relevant(&query, results);
                    if !relevant.is_empty() {
                        return Ok(relevant);
                    }
                }
            }
        }
    }

    Err("搜索失败：Tavily/SearXNG/免费源均不可用或无相关结果，请检查 API Key 或网络后重试".to_string())
}

/// 预热 Bing 会话：先访问首页拿 Set-Cookie，返回拼接好的 Cookie header。
/// 匿名 RSS 请求会被 Bing 降级为兜底内容（中文查询尤甚），带 cookie 后命中率显著提升。
async fn warmup_bing_cookie(client: &reqwest::Client) -> Option<String> {
    let resp = client.get("https://www.bing.com/").send().await.ok()?;
    let cookies: Vec<String> = resp
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_string())
        .filter(|c| !c.is_empty() && c.contains('='))
        .collect();
    if cookies.is_empty() {
        None
    } else {
        Some(cookies.join("; "))
    }
}

/// 走 Bing RSS 搜索，带 cookie + 中文市场参数，结果经相关性过滤。
/// 返回 None 表示请求失败 / 无结果 / 结果跑题，交给下一个源。
async fn bing_search(
    client: &reqwest::Client,
    host: &str,
    query: &str,
    cookie: &str,
    limit: usize,
) -> Option<Vec<SearchResult>> {
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    // 含中文时指定中文市场，避免结果只匹配查询里的拉丁/数字 token
    let mkt = if query.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)) {
        "&mkt=zh-CN"
    } else {
        ""
    };
    let url = format!("https://{}/search?q={}&format=rss{}", host, encoded, mkt);
    let mut req = client.get(&url);
    if !cookie.is_empty() {
        req = req.header("cookie", cookie);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let xml = resp.text().await.ok()?;
    let results = parse_bing_rss(&xml, limit);
    if results.is_empty() {
        return None;
    }
    let relevant = filter_relevant(query, results);
    if relevant.is_empty() {
        return None;
    }
    Some(relevant)
}

/// 解析 Bing RSS 输出（?format=rss），每项含 title / link / description。
fn parse_bing_rss(xml: &str, limit: usize) -> Vec<SearchResult> {
    let mut out = Vec::new();
    for item in xml.split("<item>").skip(1) {
        if out.len() >= limit {
            break;
        }
        let raw_title = extract_tag(item, "<title>", "</title>");
        let raw_link = extract_tag(item, "<link>", "</link>");
        let raw_desc = extract_tag(item, "<description>", "</description>");
        let title = strip_html(&unescape_xml(&raw_title));
        let url = unescape_xml(&raw_link).trim().to_string();
        let snippet = strip_html(&unescape_xml(&raw_desc));
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() || url.is_empty() {
            continue;
        }
        out.push(SearchResult {
            title,
            url,
            snippet,
        });
    }
    out
}

/// 从 XML 片段中提取首个 open..close 之间的文本。
fn extract_tag<'a>(s: &'a str, open: &str, close: &str) -> String {
    let Some(start) = s.find(open) else {
        return String::new();
    };
    let body = &s[start + open.len()..];
    let Some(end) = body.find(close) else {
        return String::new();
    };
    body[..end].to_string()
}

fn unescape_xml(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

// ── HTTP 抓取（web_fetch 用）──

async fn fetch_page(raw_url: &str) -> Result<String, String> {
    let url = validate_url(raw_url).await?;

    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(FETCH_TIMEOUT)
        .redirect(build_redirect_policy())
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("页面返回 HTTP {}", status));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    if bytes.len() > MAX_FETCH_BYTES {
        return Err(format!(
            "页面超过 {} MB 下载上限",
            MAX_FETCH_BYTES / 1024 / 1024
        ));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ── SSRF 防护 ──

/// 校验 URL 并复查域名解析，防止访问内网/保留地址。
async fn validate_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("URL 解析失败: {}", e))?;
    validate_url_sync(&url)?;

    if let Some(host) = url.host_str() {
        // 域名形式：DNS 复查所有解析结果
        if host.parse::<IpAddr>().is_err() {
            let addrs = tokio::net::lookup_host((host, 443))
                .await
                .map_err(|e| format!("域名 {} 解析失败: {}", host, e))?;
            let mut any = false;
            for addr in addrs {
                any = true;
                if is_private_ip(addr.ip()) {
                    return Err(format!("域名 {} 解析到内网地址 {}", host, addr.ip()));
                }
            }
            if !any {
                return Err(format!("域名无法解析: {}", host));
            }
        }
    }
    Ok(url)
}

/// 同步校验（协议 + IP 字面量），用于重定向回调。
fn validate_url_sync(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {}
        s => return Err(format!("不支持的协议: {}", s)),
    }
    if let Some(host) = url.host_str() {
        if let Ok(ip) = host.parse::<IpAddr>() {
            if is_private_ip(ip) {
                return Err(format!("禁止访问内网地址: {}", ip));
            }
        }
    }
    Ok(())
}

fn build_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| match validate_url_sync(attempt.url()) {
        Ok(_) => attempt.follow(),
        Err(e) => {
            eprintln!("[web_search] 重定向目标被拦截: {}", e);
            attempt.stop()
        }
    })
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || {
                    let o = v4.octets();
                    o[0] == 0 // 0.0.0.0/8
                        || (o[0] == 100 && (o[1] & 0b1100_0000) == 0b0100_0000) // 100.64.0.0/10 CGNAT
                        || (o[0] == 192 && o[1] == 0) // 192.0.0.0/24 保留 + 192.0.2.0/24 TEST-NET
                        || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // 198.18.0.0/15 基准测试
                }
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 ULA
                || v6
                    .to_ipv4_mapped()
                    .map(|v4| is_private_ip(IpAddr::V4(v4)))
                    .unwrap_or(false) // ::ffff:0:0/96
        }
    }
}

// ── DuckDuckGo 结果解析 ──

fn parse_ddg_results(html: &str, limit: usize) -> Vec<SearchResult> {
    let Ok(result_sel) = Selector::parse("div.result") else {
        return Vec::new();
    };
    let Ok(title_sel) = Selector::parse("a.result__a") else {
        return Vec::new();
    };
    let Ok(snippet_sel) = Selector::parse(".result__snippet") else {
        return Vec::new();
    };

    let document = Html::parse_document(html);
    let mut out = Vec::new();
    for el in document.select(&result_sel) {
        if out.len() >= limit {
            break;
        }
        let Some(a) = el.select(&title_sel).next() else {
            continue;
        };
        let title = a.text().collect::<String>();
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let href = a.value().attr("href").unwrap_or("").to_string();
        let url = decode_ddg_url(&href);
        let snippet = el
            .select(&snippet_sel)
            .next()
            .map(|s| s.text().collect::<String>())
            .unwrap_or_default();
        let snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() || url.is_empty() {
            continue;
        }
        out.push(SearchResult {
            title,
            url,
            snippet,
        });
    }
    out
}

/// DDG 结果链接形如 `//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`，取出真实 URL。
fn decode_ddg_url(href: &str) -> String {
    if href.is_empty() {
        return String::new();
    }
    let full = if href.starts_with("//") {
        format!("https:{}", href)
    } else {
        href.to_string()
    };
    let Ok(url) = Url::parse(&full) else {
        return String::new();
    };
    let pairs: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
    pairs.get("uddg").cloned().unwrap_or_else(|| url.to_string())
}

// ── Tavily 主源（可选）──

/// 读取 Tavily API Key：环境变量 WORLDFORGE_TAVILY_API_KEY 或设置面板的 Tavily API Key。
/// 未配置时返回 None。
fn tavily_api_key() -> Option<String> {
    std::env::var("WORLDFORGE_TAVILY_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            crate::commands::api_key::get_api_key("tavily_api_key".to_string())
                .ok()
                .filter(|s| !s.trim().is_empty())
        })
        .map(|s| s.trim().to_string())
}

/// 经 Tavily Search API 搜索（专门为 LLM agent 设计的搜索 API，结果自带相关性排序）。
async fn tavily_search(key: &str, query: &str, limit: usize) -> Option<Vec<SearchResult>> {
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(SEARCH_TIMEOUT)
        .build()
        .ok()?;

    let body = serde_json::json!({
        "query": query,
        "max_results": limit.min(20),
        "search_depth": "basic",
        "include_answer": false,
    });

    let resp = client
        .post("https://api.tavily.com/search")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;

    let results: Vec<SearchResult> = json["results"]
        .as_array()?
        .iter()
        .map(|r| SearchResult {
            title: r["title"].as_str().unwrap_or("").to_string(),
            url: r["url"].as_str().unwrap_or("").to_string(),
            snippet: r["content"].as_str().unwrap_or("").to_string(),
        })
        .filter(|r| !r.title.is_empty() && !r.url.is_empty())
        .take(limit)
        .collect();

    let relevant = filter_relevant(query, results);
    if relevant.is_empty() {
        None
    } else {
        Some(relevant)
    }
}

// ── SearXNG 回退（可选）──

/// 读取 SearXNG 实例地址：环境变量 WORLDFORGE_SEARXNG_URL 或设置面板的 SearXNG URL
/// （如 http://localhost:8888）。未配置时返回 None。
fn searxng_base_url() -> Option<String> {
    let base = std::env::var("WORLDFORGE_SEARXNG_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            crate::commands::api_key::get_api_key("searxng_url".to_string())
                .ok()
                .filter(|s| !s.trim().is_empty())
        })?;
    let base = base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        None
    } else {
        Some(base)
    }
}

/// 经 SearXNG JSON API 搜索（需在实例 settings.yml 开启 json 格式）。
async fn searxng_search(base: &str, query: &str, limit: usize) -> Option<Vec<SearchResult>> {

    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .timeout(SEARCH_TIMEOUT)
        .build()
        .ok()?;
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let url = format!("{}/search?q={}&format=json", base, encoded);

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;

    let results: Vec<SearchResult> = json["results"]
        .as_array()?
        .iter()
        .map(|r| SearchResult {
            title: r["title"].as_str().unwrap_or("").to_string(),
            url: r["url"].as_str().unwrap_or("").to_string(),
            snippet: r["content"].as_str().unwrap_or("").to_string(),
        })
        .filter(|r| !r.title.is_empty() && !r.url.is_empty())
        .take(limit)
        .collect();

    let relevant = filter_relevant(query, results);
    if relevant.is_empty() {
        None
    } else {
        Some(relevant)
    }
}

// ── 文本工具 ──

/// 从查询中提取用于相关性判断的关键词：
/// 按空白/逗号切分，去掉纯数字 token（如 2024）与常见停用词，避免数字命中掩盖跑题。
fn extract_keywords(query: &str) -> Vec<String> {
    const STOPWORDS: &[&str] = &[
        "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "at", "by",
        "latest", "news", "search", "what", "who", "when", "where", "how", "结果", "新闻",
        "消息", "最新", "近期", "查询", "的", "了", "和", "与", "在", "是", "为", "及", "或",
        "关于", "请问", "介绍", "什么",
    ];
    query
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '，' | '、' | '。' | '？' | '?'))
        .map(|t| {
            t.trim()
                .trim_matches(|c: char| c.is_ascii_punctuation() || c.is_ascii_whitespace())
        })
        .filter(|t| !t.is_empty())
        // 去掉纯数字 token：Bing 降级时常常只命中查询里的年份
        .filter(|t| !t.chars().all(|c| c.is_ascii_digit()))
        .filter(|t| {
            let lower = t.to_lowercase();
            !STOPWORDS.contains(&lower.as_str())
        })
        .map(|t| t.to_lowercase())
        .collect()
}

/// 单关键词命中判定。CJK 长词（>=4 字）额外支持前 3 字前缀匹配：
/// 结果含"诺贝尔"即可命中"诺贝尔物理学奖"——Bing 对中文词的返回常是部分命中。
/// 前缀取 3 字而非 2 字，避免"中国空间站"被"中华人民共和国"这类泛化结果命中
/// （"中华人民共和国"不含"中国空"，而"中国空间站"新闻里通常出现"中国空间站"）。
fn keyword_hit(keyword: &str, haystack: &str) -> bool {
    if haystack.contains(keyword) {
        return true;
    }
    let chars: Vec<char> = keyword.chars().collect();
    let has_cjk = chars.iter().any(|c| ('\u{4e00}'..='\u{9fff}').contains(c));
    if chars.len() >= 4 && has_cjk {
        let prefix3: String = chars[..3].iter().collect();
        return haystack.contains(&prefix3);
    }
    false
}

/// 结果与查询的相关度：命中关键词数 / 关键词总数。
/// 无可用关键词（查询全是数字/停用词）时返回 1.0，不做过滤。
fn relevance_ratio(query: &str, result: &SearchResult) -> f32 {
    let keywords = extract_keywords(query);
    if keywords.is_empty() {
        return 1.0;
    }
    let haystack = format!(
        "{} {} {}",
        result.title.to_lowercase(),
        result.url.to_lowercase(),
        result.snippet.to_lowercase()
    );
    let hits = keywords
        .iter()
        .filter(|k| keyword_hit(k, &haystack))
        .count();
    hits as f32 / keywords.len() as f32
}

/// 过滤与查询无关的结果：剔除已知兜底域名，并丢弃关键词命中率过低的"跑题"条目。
/// 阈值按关键词数动态调整——要求至少命中 1 个关键词（配合 CJK 前 3 字前缀匹配，
/// 泛化结果如只含"中国"、只含"2024"的条目无法命中任何关键词，仍会被过滤）。
fn filter_relevant(query: &str, results: Vec<SearchResult>) -> Vec<SearchResult> {
    // Bing 对匿名请求的降级兜底内容，直接剔除
    const NOISE_MARKERS: &[&str] = &[
        "scholar.google.com",
        "instagram.com",
        "google.com/maps",
        "linkedin.com",
        "facebook.com",
    ];
    let keywords = extract_keywords(query);
    if keywords.is_empty() {
        return results; // 无可用关键词（全数字/停用词），不做过滤
    }
    let min_ratio = 1.0 / keywords.len() as f32;
    results
        .into_iter()
        .filter(|r| {
            if NOISE_MARKERS
                .iter()
                .any(|m| r.url.contains(m) || r.title.to_lowercase().contains(m))
            {
                return false;
            }
            relevance_ratio(query, r) >= min_ratio
        })
        .collect()
}

/// 生成查询重试变体：
/// 1) 去掉"最新/消息/新闻"等修饰性 token；
/// 2) 去掉纯数字 token（如"2024 诺贝尔物理学奖"中的 2024）——Bing RSS 只提取查询中的
///    拉丁/数字 token，数字会把中文关键词挤掉，退化成只匹配"2024"的泛化结果。
/// 重试按顺序进行，第一个产生相关结果的变体即采用。
fn query_variants(query: &str) -> Vec<String> {
    const MODIFIERS: &[&str] = &[
        "最新", "消息", "新闻", "近期", "今天", "今日", "关于", "请问", "介绍", "详情", "结果", "情况",
    ];
    let tokens: Vec<&str> = query.split_whitespace().collect();
    if tokens.len() < 2 {
        return vec![query.to_string()];
    }
    let mut variants = vec![query.to_string()];

    let core: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|t| !MODIFIERS.iter().any(|m| t.contains(m)))
        .collect();
    if !core.is_empty() && core.len() < tokens.len() {
        variants.push(core.join(" "));
    }

    let no_numeric: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|t| !t.chars().all(|c| c.is_ascii_digit()))
        .collect();
    if !no_numeric.is_empty() && no_numeric.len() < tokens.len() {
        variants.push(no_numeric.join(" "));
    }

    // 去重（保持顺序）
    let mut seen = std::collections::HashSet::new();
    variants.retain(|v| seen.insert(v.clone()));
    variants
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut truncated: String = s.chars().take(max).collect();
    truncated.push_str("...(内容已截断)");
    truncated
}

fn remove_scripts_and_styles(html: &str) -> String {
    let mut text = html.replace('\n', " ").replace('\r', " ");
    while let Some(start) = text.find("<script") {
        if let Some(end) = text[start..].find("</script>") {
            text.replace_range(start..start + end + 9, " ");
        } else {
            break;
        }
    }
    while let Some(start) = text.find("<style") {
        if let Some(end) = text[start..].find("</style>") {
            text.replace_range(start..start + end + 8, " ");
        } else {
            break;
        }
    }
    text
}

fn strip_html(s: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(c),
            _ => {}
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fetch_private_ip_blocked() {
        let err = web_fetch("http://127.0.0.1/".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("内网"), "应拦截内网地址: {}", err);
    }

    #[tokio::test]
    async fn fetch_bad_scheme_blocked() {
        let err = web_fetch("file:///etc/passwd".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("协议"), "应拦截非 http 协议: {}", err);
    }

    #[tokio::test]
    #[ignore = "需要网络"]
    async fn fetch_public_page_ok() {
        let result = web_fetch("https://example.com".to_string()).await;
        assert!(result.is_ok(), "web_fetch 失败: {:?}", result.err());
        let text = result.unwrap();
        assert!(text.contains("Example Domain"), "提取内容异常: {}", &text[..text.len().min(200)]);
    }

    #[tokio::test]
    #[ignore = "需要网络"]
    async fn search_returns_results() {
        let results = web_search("rust programming".to_string(), Some(3)).await;
        assert!(results.is_ok(), "web_search 失败: {:?}", results.err());
        let list = results.unwrap();
        assert!(!list.is_empty(), "搜索结果为空");
        assert!(list.iter().all(|r| !r.title.is_empty() && !r.url.is_empty()));
    }

    #[test]
    fn keywords_drop_numeric_and_stopwords() {
        let kw = extract_keywords("2024 诺贝尔物理学奖 霍普菲尔德 辛顿");
        assert_eq!(kw, vec!["诺贝尔物理学奖", "霍普菲尔德", "辛顿"]);

        let kw2 = extract_keywords("DeepSeek 最新发布 模型");
        assert_eq!(kw2, vec!["deepseek", "最新发布", "模型"]);
    }

    #[test]
    fn relevance_filters_off_topic_and_noise() {
        // Bing 降级兜底：只命中查询里的数字 token → 相关度不足，被过滤
        let noise = SearchResult {
            title: "Google Scholar".into(),
            url: "https://scholar.google.com/citations".into(),
            snippet: "2024".into(),
        };
        let relevant = filter_relevant("2024 诺贝尔物理学奖 霍普菲尔德 辛顿", vec![noise]);
        assert!(relevant.is_empty(), "跑题/兜底结果应被过滤");

        // 正常相关结果保留
        let ok = SearchResult {
            title: "2024年诺贝尔物理学奖揭晓：霍普菲尔德与辛顿获奖".into(),
            url: "https://example.com/nobel-2024".into(),
            snippet: "约翰·霍普菲尔德和杰弗里·辛顿因人工神经网络研究获奖".into(),
        };
        let kept = filter_relevant("2024 诺贝尔物理学奖 霍普菲尔德 辛顿", vec![ok]);
        assert_eq!(kept.len(), 1, "相关结果应保留");
    }

    #[test]
    fn cjk_prefix_hit_partial_titles() {
        // Bing 对中文返回部分命中：标题只含"诺贝尔奖"，前缀"诺贝尔"应算命中
        let partial = SearchResult {
            title: "诺贝尔奖 - 维基百科，自由的百科全书".into(),
            url: "https://zh.wikipedia.org/wiki/诺贝尔奖".into(),
            snippet: "诺贝尔物理学奖（Nobel Prize in Physics）由瑞典皇家科学院颁发".into(),
        };
        let kept = filter_relevant("2024 诺贝尔物理学奖 霍普菲尔德 辛顿", vec![partial]);
        assert_eq!(kept.len(), 1, "部分命中的相关结果应保留");

        // 泛化结果不命中："中华人民共和国"不含前缀"中国空"，应被过滤
        let generic = SearchResult {
            title: "中华人民共和国_百度百科".into(),
            url: "https://baike.baidu.com/item/中华人民共和国/106554".into(),
            snippet: "成立于1949年10月1日".into(),
        };
        let filtered = filter_relevant("中国空间站 天宫 最新消息", vec![generic]);
        assert!(filtered.is_empty(), "泛化结果应被过滤");
    }

    #[test]
    fn query_variants_strip_modifiers() {
        // 去修饰词变体
        let v = query_variants("中国空间站 天宫 最新消息");
        assert!(v.contains(&"中国空间站 天宫".to_string()));

        // 单 token 查询不产生变体
        assert_eq!(query_variants("诺贝尔物理学奖").len(), 1);

        // 全是修饰词时只剩原查询
        assert_eq!(query_variants("最新消息 新闻").len(), 1);

        // 去数字 token 变体：2024 会诱使 Bing RSS 退化成只匹配年份
        let v2 = query_variants("2024 诺贝尔物理学奖 霍普菲尔德 辛顿");
        assert!(
            v2.contains(&"诺贝尔物理学奖 霍普菲尔德 辛顿".to_string()),
            "应生成去数字变体: {:?}",
            v2
        );
        // 原查询仍保留在变体列表首位
        assert_eq!(v2[0], "2024 诺贝尔物理学奖 霍普菲尔德 辛顿");
    }

    #[tokio::test]
    #[ignore = "需要网络"]
    async fn search_chinese_queries_relevant() {
        // 回归：日志中"诺贝尔"查询曾返回 Google Scholar 垃圾，现在必须返回相关内容
        let q = "2024 诺贝尔物理学奖 霍普菲尔德 辛顿";
        let results = web_search(q.to_string(), Some(5)).await;
        assert!(results.is_ok(), "诺贝尔查询失败: {:?}", results.err());
        let list = results.unwrap();
        assert!(!list.is_empty(), "诺贝尔查询无结果");
        // 结果必须通过相关性过滤（命中至少 1 个关键词）
        let min_ratio = 1.0 / extract_keywords(q).len() as f32;
        let ratio = relevance_ratio(q, &list[0]);
        assert!(
            ratio >= min_ratio,
            "诺贝尔查询首个结果跑题 (相关度 {}): {:?}",
            ratio,
            list[0]
        );
        // 且不应是纯数字泛化结果（如"2024年日历"）
        let first = &list[0];
        assert!(
            first.title.contains("诺贝尔") || first.title.contains("物理"),
            "首个结果与诺贝尔奖无关: {}",
            first.title
        );
    }

    #[tokio::test]
    #[ignore = "需要网络"]
    async fn search_chinese_multi_word_no_off_topic() {
        // "中国空间站"这类多词中文查询：允许无结果（过滤兜底生效），但绝不允许返回跑题结果
        let q = "中国空间站 天宫 最新消息";
        match web_search(q.to_string(), Some(5)).await {
            Ok(list) => {
                assert!(!list.is_empty(), "查询 [{}] 无结果", q);
                let min_ratio = 1.0 / extract_keywords(q).len() as f32;
                let ratio = relevance_ratio(q, &list[0]);
                assert!(
                    ratio >= min_ratio,
                    "查询 [{}] 首个结果跑题 (相关度 {}): {:?}",
                    q,
                    ratio,
                    list[0]
                );
            }
            Err(e) => {
                assert!(
                    e.contains("无相关结果") || e.contains("搜索失败"),
                    "异常错误信息: {}",
                    e
                );
            }
        }
    }
}
