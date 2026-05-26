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
    let html = fetch_page(&url).await?;
    let clean = strip_html(&remove_scripts_and_styles(&html));
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

/// Web search via Bing Web Search API.
/// Free tier: 1000 calls/month. Requires API key in settings.
#[tauri::command]
pub async fn web_search(query: String, count: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let limit = count.unwrap_or(5).min(10);

    let api_key = crate::commands::api_key::get_api_key("bing_search".to_string())
        .map_err(|_| "未配置 Bing Search API Key，请在设置中填入。获取地址：https://portal.azure.com → 创建 Bing Search 资源（免费层 1000次/月）".to_string())?;

    let url = format!(
        "https://api.bing.microsoft.com/v7.0/search?q={}&count={}&mkt=zh-CN",
        urlencode(&query),
        limit
    );

    let client = reqwest::Client::builder()
        .user_agent("WorldForge/0.6")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构建客户端失败: {}", e))?;

    let body = client
        .get(&url)
        .header("Ocp-Apim-Subscription-Key", &api_key)
        .send()
        .await
        .map_err(|e| format!("Bing API 请求失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let parsed = serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|e| format!("Bing API 响应解析失败: {}. 原始响应: {}", e, &body[..body.len().min(200)]))?;

    if let Some(error) = parsed["error"].as_object() {
        let msg = error.get("message").and_then(|v| v.as_str()).unwrap_or("未知错误");
        return Err(format!("Bing API 错误: {}", msg));
    }

    let results: Vec<SearchResult> = parsed["webPages"]["value"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .take(limit)
        .map(|r| SearchResult {
            title: r["name"].as_str().unwrap_or("").to_string(),
            url: r["url"].as_str().unwrap_or("").to_string(),
            snippet: r["snippet"].as_str().unwrap_or("").to_string(),
        })
        .filter(|r| !r.title.is_empty() && !r.url.is_empty())
        .collect();

    if results.is_empty() {
        Err("Bing 未返回任何搜索结果".to_string())
    } else {
        Ok(results)
    }
}

// ── HTTP helper for web_fetch ──

async fn fetch_page(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
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

// ── URL encoding ──

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
