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

/// Web search using DuckDuckGo Lite (no JS required, no API key)
#[tauri::command]
pub async fn web_search(query: String, count: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let limit = count.unwrap_or(5).min(10);
    let url = format!("https://lite.duckduckgo.com/lite/?q={}", urlencoding(&query));

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; WorldForge/0.1)")
        .build()
        .map_err(|e| format!("构建客户端失败: {}", e))?;

    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let results = parse_duckduckgo_lite(&html, limit);
    if results.is_empty() {
        Err("未找到搜索结果（可能是 DuckDuckGo 暂时不可用，请稍后重试）".to_string())
    } else {
        Ok(results)
    }
}

fn urlencoding(s: &str) -> String {
    // Proper UTF-8 percent-encoding
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

fn parse_duckduckgo_lite(html: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Split into blocks around result links. Each result has:
    //   <a rel="nofollow" href="..." class="result-link">Title</a>
    //   <span class="result-snippet">Snippet...</span>
    let blocks: Vec<&str> = html.split("result-link").collect();
    for block in &blocks[1..] { // skip first (before any result)
        if results.len() >= limit { break; }

        let url = extract_between(block, "href=\"", "\"")
            .map(|u| u.to_string())
            .unwrap_or_default();

        let title = block
            .split("</a>").next()
            .map(|s| {
                let parts: Vec<&str> = s.split('>').collect();
                strip_html(parts.last().unwrap_or(&"")).trim().to_string()
            })
            .unwrap_or_default();

        // Extract snippet — either from <span class="result-snippet"> or subsequent text
        let snippet = extract_between(block, "result-snippet\">", "</span>")
            .or_else(|| {
                // Fallback: text after </a> up to next <
                block.split("</a>").nth(1)
                    .and_then(|s| s.split('<').next())
                    .map(|s| s.trim())
                    .filter(|s| s.len() > 20)
            })
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty()
            && results.iter().all(|r: &SearchResult| r.title != title)
        {
            results.push(SearchResult { title, url, snippet });
        }
    }

    if results.is_empty() {
        results = parse_duckduckgo_legacy(html, limit);
    }
    results
}

fn parse_duckduckgo_legacy(html: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // Parse each result block
    for block in html.split("result__body") {
        if results.len() >= limit { break; }

        let title = block
            .split("result__title\"").nth(1)
            .and_then(|s| s.split("</a>").next())
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        let snippet = block
            .split("result__snippet\"").nth(1)
            .and_then(|s| s.split("</").next())
            .map(|s| strip_html(s).trim().to_string())
            .unwrap_or_default();

        let url = block
            .split("result__url\"").nth(1)
            .and_then(|s| s.split("href=\"").nth(1))
            .and_then(|s| s.split('"').next())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if !title.is_empty() && results.iter().all(|r: &SearchResult| r.title != title) {
            results.push(SearchResult { title, url, snippet });
        }
    }

    // Fallback: try simpler pattern
    if results.is_empty() {
        for block in html.split("result__title") {
            if results.len() >= limit { break; }
            let title = block.split("</a>").next().unwrap_or("")
                .split('>').last().unwrap_or("").trim().to_string();
            if !title.is_empty() && title.len() < 200 {
                results.push(SearchResult { title, url: String::new(), snippet: String::new() });
            }
        }
    }

    results
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

fn extract_between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = text.find(start)? + start.len();
    let e = text[s..].find(end)?;
    Some(&text[s..s + e])
}
