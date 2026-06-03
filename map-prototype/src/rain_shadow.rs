/// 雨影效应模型
///
/// 模拟盛行西风带（从西向东）遇山脉抬升时的降水差异：
/// - 迎风坡：气流抬升冷却，降水充沛
/// - 背风坡：干燥气流下沉，降水稀少（雨影区）
///
/// 算法：对每像素沿 −x 方向（西→东风向的反向）追踪，
/// 累计海拔增益，增益越大则雨影越强。

/// 降水量网格（0=完全干旱，1=充沛）
pub struct PrecipitationGrid {
    pub values: Vec<f32>,
}

/// 计算降水量因子
///
/// 对每个陆地像素，沿西风反方向追踪海拔增益。
/// `max_trace_steps`：最大追踪步数（默认 100）
/// `gain_threshold`：海拔增益阈值，超过此值认为完全干旱（默认 0.3）
/// `max_shadow`：最大降水减少比例（默认 0.6 = 减少 60%）
pub fn compute_rain_shadow(
    elevation: &[f32],
    width: usize,
    height: usize,
    ocean_threshold: f32,
    max_trace_steps: usize,
    gain_threshold: f32,
    max_shadow: f32,
) -> PrecipitationGrid {
    let size = width * height;
    let mut precipitation = vec![1.0f32; size];

    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;

            // 海洋：降水充足
            if elevation[idx] < ocean_threshold {
                continue;
            }

            // 从当前像素向西（−x）追踪
            let mut cumulative_gain = 0.0;
            let mut prev_elev = elevation[idx];
            let mut hit_ocean = false;

            for step in 1..=max_trace_steps {
                let tx = if x >= step { x - step } else { break };

                let tidx = y * width + tx;
                let elev = elevation[tidx];

                // 追踪过程中遇到海洋 → 重置（海洋提供水汽）
                if elev < ocean_threshold {
                    hit_ocean = true;
                    break;
                }

                // 累计海拔上升（只计上升段）
                if elev > prev_elev {
                    cumulative_gain += elev - prev_elev;
                }

                prev_elev = elev;
            }

            // 计算降水因子
            let shadow_factor = if hit_ocean {
                // 追踪到海洋：空气重新获得水汽
                // 但仍可能有部分雨影（如果刚翻过山）
                (cumulative_gain / gain_threshold).min(1.0)
            } else {
                // 未追踪到海洋：使用完整累积
                (cumulative_gain / gain_threshold).min(1.0)
            };

            let precipitation_factor = 1.0 - shadow_factor * max_shadow;
            precipitation[idx] = precipitation_factor.max(0.0);
        }
    }

    PrecipitationGrid { values: precipitation }
}

/// 简化接口（默认参数）
pub fn compute_rain_shadow_default(
    elevation: &[f32],
    width: usize,
    height: usize,
    ocean_threshold: f32,
) -> PrecipitationGrid {
    compute_rain_shadow(elevation, width, height, ocean_threshold, 100, 0.3, 0.6)
}
