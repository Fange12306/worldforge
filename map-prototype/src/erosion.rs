/// 粒子水力侵蚀（Mei et al. 2007）
///
/// 算法核心：大量水滴沿地形梯度移动，携带沉积物。
/// 当携带能力 > 负载时侵蚀地形，< 负载时沉积。
/// 蒸发使水滴逐渐消失，形成山谷网络和冲积扇。

use crate::heightmap::LCG;

/// 侵蚀参数
#[derive(Debug, Clone)]
pub struct ErosionParams {
    /// 水滴总数（512×512 地图推荐 200k）
    pub drop_count: usize,
    /// 侵蚀速率 —— 每次侵蚀最多移除的高度
    pub erosion_rate: f32,
    /// 沉积速率 —— 每次沉积最多增加的高度
    pub deposition_rate: f32,
    /// 沉积物携带能力系数
    pub sediment_capacity: f32,
    /// 蒸发率 —— 每步蒸发比例
    pub evaporation_rate: f32,
    /// 重力对速度的影响
    pub gravity: f32,
    /// 水滴最大步数
    pub max_steps: u32,
    /// 最小坡度（低于此值认为平地，直接沉积）
    pub min_slope: f32,
}

impl Default for ErosionParams {
    fn default() -> Self {
        Self {
            drop_count: 200_000,
            erosion_rate: 0.05,
            deposition_rate: 0.05,
            sediment_capacity: 10.0,
            evaporation_rate: 0.01,
            gravity: 4.0,
            max_steps: 100,
            min_slope: 0.001,
        }
    }
}

/// 粒子水力侵蚀
///
/// 输入高度图 `heightmap`（[0,1] 范围），原地修改以反映侵蚀效果。
/// `seed` 用于水滴随机初始位置。
pub fn hydraulic_erosion(
    heightmap: &mut [f32],
    width: usize,
    height: usize,
    seed: u32,
    params: &ErosionParams,
) {
    let mut rng = LCG::new(seed.wrapping_add(999));

    for _drop in 0..params.drop_count {
        // 随机初始位置（next() 返回 top 32 bits，值域 [0, 2^32)）
        let pos_x = (rng.next() as f64 / u32::MAX as f64) * (width - 1) as f64;
        let pos_y = (rng.next() as f64 / u32::MAX as f64) * (height - 1) as f64;

        let mut x = pos_x;
        let mut y = pos_y;
        let mut speed: f32 = 1.0;
        let mut sediment: f32 = 0.0;
        let mut water: f32 = 1.0;

        for _step in 0..params.max_steps {
            let cell_x = x as usize;
            let cell_y = y as usize;

            // 边界检查
            if cell_x >= width - 1 || cell_y >= height - 1 {
                break;
            }

            // 采样当前高度和梯度
            let h = bilerp(heightmap, width, height, x, y);
            if h < 0.001 {
                // 掉入海洋：沉积所有 sediment 并结束
                deposit_at(heightmap, width, height, x, y, sediment, params.deposition_rate);
                break;
            }

            let (gx, gy) = gradient(heightmap, width, height, x, y);
            let slope = (gx * gx + gy * gy).sqrt();

            if slope <= params.min_slope {
                // 平地：直接沉积所有携带物
                deposit_at(heightmap, width, height, x, y, sediment, params.deposition_rate);
                break;
            }

            // 归一化梯度方向
            let inv_slope = 1.0 / slope;
            let dx = -(gx * inv_slope) as f64;
            let dy = -(gy * inv_slope) as f64;

            // 沿梯度移动
            x += dx;
            y += dy;

            // 再次边界检查
            let cell_x = x as usize;
            let cell_y = y as usize;
            if cell_x < 1 || cell_x >= width - 1 || cell_y < 1 || cell_y >= height - 1 {
                break;
            }

            // 采样新位置高度
            let new_h = bilerp(heightmap, width, height, x, y);

            // 高度差（携带势能变化）
            let dh = new_h - h;

            if dh >= 0.0 {
                // 上坡：沉积以降低高度，防止震荡
                // 沉积量取决于上坡幅度
                let deposit_amount = (dh * params.deposition_rate * 10.0).min(sediment);
                if deposit_amount > 0.0 {
                    let cx = (x + (x - dx)) / 2.0;
                    let cy = (y + (y - dy)) / 2.0;
                    deposit_at(heightmap, width, height, cx, cy, deposit_amount, 1.0);
                    sediment -= deposit_amount;
                }
                // 给一点随机扰动以避免卡住
                x += (rng.next() as f64 / u32::MAX as f64 - 0.5) * 0.5;
                y += (rng.next() as f64 / u32::MAX as f64 - 0.5) * 0.5;
                continue;
            }

            // 下坡：更新速度
            speed = (speed * speed + params.gravity * (-dh)).sqrt();
            // 限制最大速度
            speed = speed.min(20.0);

            // 携带能力：与 slope 和 speed 成正比
            let capacity = params.sediment_capacity * (-dh) * speed * water;

            if sediment > capacity {
                // 过度负载 → 沉积
                let deposit_amount = (sediment - capacity) * params.deposition_rate;
                deposit_at(heightmap, width, height, x, y, deposit_amount, 1.0);
                sediment -= deposit_amount;
            } else {
                // 还有携带空间 → 侵蚀
                let erode_amount = (capacity - sediment) * params.erosion_rate * (-dh).min(1.0);
                if erode_amount > 0.0 {
                    let eroded = erode_at(heightmap, width, height, x, y, erode_amount);
                    sediment += eroded;
                }
            }

            // 蒸发
            water *= 1.0 - params.evaporation_rate;
            if water < 0.01 || speed < params.min_slope {
                // 水太少或太慢：沉积剩余 sediment 并结束
                if sediment > 0.0 {
                    deposit_at(heightmap, width, height, x, y, sediment, params.deposition_rate);
                }

                break;
            }
        }
    }

}

/// 双线性插值采样高度
fn bilerp(grid: &[f32], width: usize, height: usize, x: f64, y: f64) -> f32 {
    let x = x.clamp(0.0, (width - 1) as f64);
    let y = y.clamp(0.0, (height - 1) as f64);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);

    let fx = (x - x0 as f64) as f32;
    let fy = (y - y0 as f64) as f32;

    let h00 = grid[y0 * width + x0];
    let h10 = grid[y0 * width + x1];
    let h01 = grid[y1 * width + x0];
    let h11 = grid[y1 * width + x1];

    let top = h00 + (h10 - h00) * fx;
    let bot = h01 + (h11 - h01) * fx;
    top + (bot - top) * fy
}

/// 梯度（中心差分）
fn gradient(grid: &[f32], width: usize, height: usize, x: f64, y: f64) -> (f32, f32) {
    let x = x.clamp(0.0, (width - 1) as f64);
    let y = y.clamp(0.0, (height - 1) as f64);

    // 用 bilerp 在 ±0.5 偏移处采样计算中心差分
    let h_ex = bilerp(grid, width, height, (x + 0.5).min((width - 1) as f64), y);
    let h_wx = bilerp(grid, width, height, (x - 0.5).max(0.0), y);
    let h_ny = bilerp(grid, width, height, x, (y + 0.5).min((height - 1) as f64));
    let h_sy = bilerp(grid, width, height, x, (y - 0.5).max(0.0));

    let gx = h_ex - h_wx;
    let gy = h_ny - h_sy;

    (gx, gy)
}

/// 在位置 (x, y) 处移除高度（侵蚀），返回实际移除量
fn erode_at(grid: &mut [f32], width: usize, height: usize, x: f64, y: f64, amount: f32) -> f32 {
    let x = x.clamp(0.0, (width - 1) as f64);
    let y = y.clamp(0.0, (height - 1) as f64);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);

    let fx = (x - x0 as f64) as f32;
    let fy = (y - y0 as f64) as f32;

    // 四个角的权重
    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;

    let mut total_eroded = 0.0;

    for (&wx, &wy, weight) in [&x0, &x1, &x0, &x1]
        .iter()
        .zip([&y0, &y0, &y1, &y1].iter())
        .zip([w00, w10, w01, w11].iter())
        .map(|((&a, &b), c)| (a, b, c))
    {
        let idx = wy * width + wx;
        let delta = (amount * weight).min(grid[idx]);
        grid[idx] -= delta;
        total_eroded += delta;
    }

    total_eroded
}

/// 在位置 (x, y) 处增加高度（沉积）
fn deposit_at(grid: &mut [f32], width: usize, height: usize, x: f64, y: f64, amount: f32, rate: f32) {
    let x = x.clamp(0.0, (width - 1) as f64);
    let y = y.clamp(0.0, (height - 1) as f64);

    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);

    let fx = (x - x0 as f64) as f32;
    let fy = (y - y0 as f64) as f32;

    let w00 = (1.0 - fx) * (1.0 - fy);
    let w10 = fx * (1.0 - fy);
    let w01 = (1.0 - fx) * fy;
    let w11 = fx * fy;

    let deposit = amount * rate;

    for (&wx, &wy, weight) in [&x0, &x1, &x0, &x1]
        .iter()
        .zip([&y0, &y0, &y1, &y1].iter())
        .zip([w00, w10, w01, w11].iter())
        .map(|((&a, &b), c)| (a, b, c))
    {
        let idx = wy * width + wx;
        grid[idx] += deposit * weight;
        grid[idx] = grid[idx].min(1.0);
    }
}
