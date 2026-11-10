//! Issue texts (GitLab Markdown, GitHub HTML) turned into HTML that is safe to show in the webview.

use std::borrow::Cow;

use ammonia::{Builder, UrlRelative, UrlRelativeEvaluate};
use pulldown_cmark::{html, Options, Parser};

/// Render GitLab/GitHub-flavoured Markdown, then [`sanitize`] it.
pub fn render(markdown: &str, project_url: &str) -> String {
    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_GFM;
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(markdown, opts));
    sanitize(&out, project_url)
}

/// Keep formatting, tables, images and http(s)/mailto links only: scripts, styles, event
/// handlers, forms and `javascript:` URLs go away. Relative URLs resolve against the project
/// web page (GitLab writes attachments as `/uploads/...`, relative to the project).
pub fn sanitize(html: &str, project_url: &str) -> String {
    let base = project_url.trim_end_matches('/').to_string();
    Builder::default()
        // Task lists: read-only checkboxes.
        .add_tags(["input"])
        .add_tag_attributes("input", ["type", "checked"])
        .set_tag_attribute_value("input", "disabled", "")
        .attribute_filter(|element, attribute, value| match (element, attribute) {
            ("input", "type") => Some(Cow::Borrowed("checkbox")),
            _ => Some(Cow::Borrowed(value)),
        })
        .add_tag_attributes("td", ["align"])
        .add_tag_attributes("th", ["align"])
        .url_relative(UrlRelative::Custom(Box::new(ProjectUrls(base))))
        .clean(html)
        .to_string()
}

struct ProjectUrls(String);

impl UrlRelativeEvaluate<'_> for ProjectUrls {
    fn evaluate<'u>(&self, url: &'u str) -> Option<Cow<'u, str>> {
        resolve(url, &self.0)
    }
}

fn resolve<'u>(url: &'u str, base: &str) -> Option<Cow<'u, str>> {
    if url.starts_with('#') {
        return Some(Cow::Borrowed(url));
    }
    if let Some(rest) = url.strip_prefix("//") {
        return Some(Cow::Owned(format!("https://{rest}")));
    }
    if base.is_empty() {
        return None;
    }
    Some(Cow::Owned(if url.starts_with("/uploads/") {
        format!("{base}{url}")
    } else if url.starts_with('/') {
        format!("{}{url}", origin(base))
    } else {
        format!("{base}/{url}")
    }))
}

/// `https://host[:port]` of a URL.
fn origin(url: &str) -> &str {
    let start = url.find("://").map(|i| i + 3).unwrap_or(0);
    match url[start..].find('/') {
        Some(i) => &url[..start + i],
        None => url,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GL: &str = "https://gitlab.example.com/team/app";

    #[test]
    fn renders_gfm() {
        let html = render("## Titolo\n\n- [x] fatto\n- [ ] da fare\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code` ~~no~~", GL);
        assert!(html.contains("<h2>Titolo</h2>"), "{html}");
        assert!(html.contains(r#"<input type="checkbox" checked="" disabled="">"#), "{html}");
        assert!(html.contains(r#"<input type="checkbox" disabled="">"#), "{html}");
        assert!(html.contains("<table>") && html.contains("<td>2</td>"), "{html}");
        assert!(html.contains("<code>code</code>") && html.contains("<del>no</del>"), "{html}");
    }

    #[test]
    fn strips_scripts_handlers_and_js_urls() {
        let html = render(
            "<script>alert(1)</script>\n\n<img src=\"x.png\" onerror=\"alert(2)\">\n\n[link](javascript:alert(3))\n\n<input type=\"text\" value=\"x\"><style>p{}</style>",
            GL,
        );
        assert!(!html.contains("script") && !html.contains("alert"), "{html}");
        assert!(!html.contains("onerror") && !html.contains("<style"), "{html}");
        assert!(!html.contains("type=\"text\"") && !html.contains("value="), "{html}");
        assert!(html.contains("<a rel=\"noopener noreferrer\">link</a>"), "{html}");
    }

    #[test]
    fn resolves_relative_urls_against_the_project() {
        let html = render("![shot](/uploads/abc/shot.png) [issue](/team/app/-/issues/3) [doc](docs/a.md) [web](//cdn.example.com/x)", GL);
        assert!(html.contains(r#"src="https://gitlab.example.com/team/app/uploads/abc/shot.png""#), "{html}");
        assert!(html.contains(r#"href="https://gitlab.example.com/team/app/-/issues/3""#), "{html}");
        assert!(html.contains(r#"href="https://gitlab.example.com/team/app/docs/a.md""#), "{html}");
        assert!(html.contains(r#"href="https://cdn.example.com/x""#), "{html}");
    }

    #[test]
    fn keeps_provider_html_formatting() {
        let html = sanitize(
            r#"<p dir="auto">Vedi <a href="https://github.com/o/r/issues/2" class="issue-link">#2</a></p><details><summary>Log</summary><pre><code>ok</code></pre></details>"#,
            "https://github.com/o/r",
        );
        assert!(html.contains(r#"<a href="https://github.com/o/r/issues/2" rel="noopener noreferrer">#2</a>"#), "{html}");
        assert!(html.contains("<details><summary>Log</summary><pre><code>ok</code></pre></details>"), "{html}");
    }
}
