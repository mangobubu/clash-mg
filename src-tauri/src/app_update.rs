use serde::Serialize;
use tauri::AppHandle;

const RELEASE_API_URL: &str = "https://api.github.com/repos/mangobubu/clash-mg/releases/latest";
const RELEASES_URL: &str = "https://github.com/mangobubu/clash-mg/releases";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub release_notes: String,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: Option<String>,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
}

pub async fn check(app: AppHandle) -> Result<AppUpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let release = reqwest::Client::new()
        .get(RELEASE_API_URL)
        .header(reqwest::header::USER_AGENT, "clash-mg-update-checker")
        .send()
        .await
        .map_err(|error| format!("检查应用更新失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("检查应用更新失败：{error}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("解析应用更新信息失败：{error}"))?;

    if release.draft || release.prerelease {
        return Err("最新发布版本不可用于稳定更新".into());
    }

    let latest_version = release.tag_name.trim_start_matches(['v', 'V']).to_string();
    Ok(AppUpdateInfo {
        update_available: version_is_newer(&latest_version, &current_version),
        current_version,
        latest_version,
        release_url: release.html_url.unwrap_or_else(|| RELEASES_URL.into()),
        release_notes: release.body.unwrap_or_default(),
    })
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| {
        value
            .split(['-', '+'])
            .next()
            .unwrap_or(value)
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let mut candidate = parse(candidate);
    let mut current = parse(current);
    let length = candidate.len().max(current.len());
    candidate.resize(length, 0);
    current.resize(length, 0);
    candidate > current
}

#[cfg(test)]
mod tests {
    use super::version_is_newer;

    #[test]
    fn compares_release_versions_numerically() {
        assert!(version_is_newer("1.10.0", "1.9.9"));
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(!version_is_newer("1.0.0", "1.0.0"));
        assert!(!version_is_newer("1.0.0-beta.1", "1.0.0"));
    }
}
