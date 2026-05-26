use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Fetch and extract readable text content from a URL
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("WorldForge/0.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建客户端失败: {}", e))?;

    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取失败: {}", e))?;

    // Simple readable text extraction: remove scripts, styles, tags
    let mut text = html
        .replace('\n', " ")
        .replace('\r', " ");
    // Remove script/style blocks
    while let Some(start) = text.find("<script") {
        if let Some(end) = text[start..].find("</script>") {
            text.replace_range(start..start + end + 9, " ");
        } else { break; }
    }
    while let Some(start) = text.find("<style") {
        if let Some(end) = text[start..].find("</style>") {
            text.replace_range(start..start + end + 8, " ");
        } else { break; }
    }
    // Strip remaining HTML tags
    let clean = strip_html(&text);
    // Collapse whitespace
    let words: Vec<&str> = clean.split_whitespace().collect();
    let result = words.join(" ");
    if result.len() < 50 {
        Err("页面内容过短，可能是需要 JavaScript 的动态页面".to_string())
    } else if result.len() > 8000 {
        Ok(result[..8000].to_string() + "...(内容已截断)")
    } else {
        Ok(result)
    }
}

/// Web search with multi-engine fallback: Google → Bing → Baidu
#[tauri::command]
pub async fn web_search(query: String, count: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let limit = count.unwrap_or(5).min(10);
    let engines: &[(fn(&str, &str, usize) -> Vec<SearchResult>, &str, &str)] = &[
        (parse_google, "https://www.google.com/search?q={q}&hl=zh-CN", "Google"),
        (parse_bing, "https://www.bing.com/search?q={q}&setlang=zh-Hans", "Bing"),
        (parse_baidu, "https://www.baidu.com/s?wd={q}", "百度"),
    ];

    let mut errors: Vec<String> = Vec::new();

    for (parser, url_template, engine_name) in engines {
        let url = url_template.replace("{q}", &urlencode(&query));
        match fetch_page(&url).await {
            Ok(html) => {
                let results = parser(&html, engine_name, limit);
                if !results.is_empty() {
                    return Ok(results);
                }
                errors.push(format!("{} 返回空结果", engine_name));
            }
            Err(e) => {
                errors.push(format!("{}: {}", engine_name, e));
            }
        }
    }

    Err(format!("所有搜索引擎均失败:\n{}", errors.join("\n")))
}

async fn fetch_page(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构建客户端失败: {}", e))?;

    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

// ── Google parser ──

fn parse_google(html: &str, _engine: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Google search result blocks: <div class="g"> or <div data-sokoban-container>
    for block in html.split("<div class=\"g\">").skip(1) {
        if results.len() >= limit { break; }

        // Try to find link in <a href="/url?q=..."> or <a href="https://...">
        let url = block
            .split("href=\"/url?q=").nth(1)
            .and_then(|s| s.split('&').next())
            .map(|s| percent_decode(s))
            .or_else(|| {
                block.split("href=\"").nth(1)
                    .and_then(|s| s.split('"').next())
                    .filter(|u| u.starts_with("http"))
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();

        let title = block
            .split("<h3").nth(1)
            .and_then(|s| s.split("</h3>").next())
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        let snippet = block
            .split("<span class=\"st\">").nth(1)
            .or_else(|| block.split("<div class=\"VwiC3b\"").nth(1))
            .or_else(|| block.split("<span class=\"aCOpRe\"").nth(1))
            .and_then(|s| s.split("</span>").next())
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty()
            && results.iter().all(|r: &SearchResult| r.title != title)
        {
            results.push(SearchResult { title, url, snippet });
        }
    }

    results
}

// ── Bing parser ──

fn parse_bing(html: &str, _engine: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Bing result blocks: <li class="b_algo">
    for block in html.split("class=\"b_algo\"").skip(1) {
        if results.len() >= limit { break; }

        let url = block
            .split("href=\"").nth(1)
            .and_then(|s| s.split('"').next())
            .filter(|u| u.starts_with("http"))
            .map(|s| s.to_string())
            .unwrap_or_default();

        let title = block
            .split("<h2>").nth(1)
            .or_else(|| block.split("<h2 ").nth(1))
            .and_then(|s| s.split("</h2>").next())
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        let snippet = block
            .split("<p>").nth(1)
            .or_else(|| block.split("<p ").nth(1))
            .and_then(|s| s.split("</p>").next())
            .map(|s| strip_html(s).trim().to_string())
            .or_else(|| {
                block.split("<span class=\"algoSlug_icon\"").nth(1)
                    .and_then(|s| s.split("</div>").next())
                    .map(|s| strip_html(s).trim().to_string())
            })
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty()
            && results.iter().all(|r: &SearchResult| r.title != title)
        {
            results.push(SearchResult { title, url, snippet });
        }
    }

    results
}

// ── Baidu parser ──

fn parse_baidu(html: &str, _engine: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Baidu result blocks: <div class="result c-container" or <div class="c-container">
    for block in html.split("class=\"c-container").skip(1) {
        if results.len() >= limit { break; }

        let url = block
            .split("href=\"").nth(1)
            .and_then(|s| s.split('"').next())
            .filter(|u| u.starts_with("http"))
            .map(|s| s.to_string())
            .unwrap_or_default();

        let title = block
            .split("<h3").nth(1)
            .and_then(|s| s.split("</h3>").next())
            .or_else(|| block.split("<a ").nth(1).and_then(|s| s.split("</a>").next()))
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        let snippet = block
            .split("class=\"c-abstract\"").nth(1)
            .or_else(|| block.split("class=\"c-span-last\"").nth(1))
            .or_else(|| block.split("<span class=\"content-right_").nth(1))
            .and_then(|s| s.split("</span>").next())
            .or_else(|| {
                block.split("<div class=\"c-span18").nth(1)
                    .and_then(|s| s.split("</div>").next())
            })
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty()
            && results.iter().all(|r: &SearchResult| r.title != title)
        {
            results.push(SearchResult { title, url, snippet });
        }
    }

    results
}

// ── Helpers ──

fn urlencode(s: &str) -> String {
    let mut result = String::new();
    for byte in s.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(*byte as char);
            }
            b' ' => {
                result.push('+');
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

fn percent_decode(s: &str) -> String {
    let mut result = String::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                result.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            result.push(' ');
            i += 1;
            continue;
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'A'..=b'F' => Some(b - b'A' + 10),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
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
