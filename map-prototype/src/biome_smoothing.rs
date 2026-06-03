/// 生物群落众数滤波平滑
///
/// 使用滑动窗口众数（majority）滤波器去除生物群落图中的椒盐噪声。
/// 只对非海洋、非冰川像素应用，保护边界清晰度。

use crate::biomes::BiomeId;

/// 众数滤波
///
/// 对每个陆地像素，取 `window_size`×`window_size` 窗口内 biome 众数，
/// 若众数占比 >= `min_majority_pct`，则替换该像素。
///
/// # 参数
/// - `biomes`: 输入 biome 网格
/// - `elevation`: 高度图（用于判断海洋/冰川）
/// - `width`, `height`: 网格尺寸
/// - `ocean_threshold`: 海洋阈值
/// - `window_size`: 窗口大小（建议 5，即 5×5）
/// - `min_majority_pct`: 最小多数比例（0.0~1.0，建议 0.4）
/// - `iterations`: 迭代次数（建议 2）
pub fn smooth_biomes(
    biomes: &[BiomeId],
    elevation: &[f32],
    width: usize,
    height: usize,
    ocean_threshold: f32,
    window_size: usize,
    min_majority_pct: f32,
    iterations: usize,
) -> Vec<BiomeId> {
    let mut result = biomes.to_vec();
    let half = window_size / 2;
    let min_count = (window_size * window_size) as f32 * min_majority_pct;
    let min_count = min_count.ceil() as usize;

    for _iter in 0..iterations {
        let input = result.clone();

        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;

                // 跳过海洋
                if elevation[idx] < ocean_threshold {
                    continue;
                }

                // 跳过冰川（保护边界）
                if input[idx] == BiomeId::Glacier {
                    continue;
                }

                // 统计窗口内 biome 频率
                let mut counts = vec![0usize; 20]; // 足够容纳所有 biome

                for wy in y.saturating_sub(half)..=y + half {
                    for wx in x.saturating_sub(half)..=x + half {
                        if wx < width && wy < height {
                            let widx = wy * width + wx;
                            // 只统计陆地 biome
                            if elevation[widx] >= ocean_threshold {
                                counts[input[widx] as usize] += 1;
                            }
                        }
                    }
                }

                // 找众数
                let mut max_count = 0;
                let mut mode = input[idx];
                for (biome_id, &count) in counts.iter().enumerate() {
                    if count > max_count {
                        max_count = count;
                        mode = match biome_id {
                            0 => BiomeId::Ocean,
                            1 => BiomeId::Beach,
                            2 => BiomeId::HotDesert,
                            3 => BiomeId::ColdDesert,
                            4 => BiomeId::Savanna,
                            5 => BiomeId::Grassland,
                            6 => BiomeId::Shrubland,
                            7 => BiomeId::TemperateDeciduousForest,
                            8 => BiomeId::TemperateRainforest,
                            9 => BiomeId::TropicalSeasonalForest,
                            10 => BiomeId::TropicalRainforest,
                            11 => BiomeId::BorealForest,
                            12 => BiomeId::Taiga,
                            13 => BiomeId::Tundra,
                            14 => BiomeId::Glacier,
                            _ => BiomeId::Ocean,
                        };
                    }
                }

                // 如果众数占比足够高，替换
                if max_count >= min_count {
                    result[idx] = mode;
                }
            }
        }
    }

    result
}

/// 快速平滑（默认参数）
pub fn smooth_biomes_default(
    biomes: &[BiomeId],
    elevation: &[f32],
    width: usize,
    height: usize,
    ocean_threshold: f32,
) -> Vec<BiomeId> {
    smooth_biomes(biomes, elevation, width, height, ocean_threshold, 5, 0.4, 2)
}
