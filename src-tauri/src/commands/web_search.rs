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

/// Web search via Tavily API (https://tavily.com).
/// Designed for AI agents — simple REST API, no monthly hard cap.
#[tauri::command]
pub async fn web_search(query: String, count: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let limit = count.unwrap_or(5).min(10);

    let api_key = crate::commands::api_key::get_api_key("tavily".to_string())
        .map_err(|_| "未配置 Tavily API Key，请在设置中填入。获取地址：https://app.tavily.com".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("WorldForge/0.6")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建客户端失败: {}", e))?;

    let body = serde_json::json!({
        "query": query,
        "search_depth": "basic",
        "max_results": limit,
    });

    let resp = client
        .post("https://api.tavily.com/search")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Tavily API 请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Tavily API 错误 {}: {}", status, text));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Tavily API 响应解析失败: {}", e))?;

    let results: Vec<SearchResult> = json["results"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| SearchResult {
            title: r["title"].as_str().unwrap_or("").to_string(),
            url: r["url"].as_str().unwrap_or("").to_string(),
            snippet: r["content"].as_str().unwrap_or("").to_string(),
        })
        .filter(|r| !r.title.is_empty() && !r.url.is_empty())
        .collect();

    if results.is_empty() {
        Err("Tavily 未返回任何搜索结果".to_string())
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
