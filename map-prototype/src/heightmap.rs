use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::LazyLock;

/// ─── 基于种子动态生成 permutation table 的改进 Perlin 噪声 ───

/// 根据种子生成随机 permutation table（Fisher-Yates 洗牌）
pub fn make_perm(seed: u32) -> [usize; 512] {
    let mut rng = LCG::new(seed);
    let mut p: [usize; 256] = core::array::from_fn(|i| i);
    for i in (1..256).rev() {
        let j = (rng.next() as usize) % (i + 1);
        p.swap(i, j);
    }
    let mut perm = [0usize; 512];
    for i in 0..512 {
        perm[i] = p[i & 255];
    }
    perm
}

/// 简单 LCG 随机数生成器
pub(crate) struct LCG { pub(crate) state: u64 }
impl LCG {
    pub(crate) fn new(seed: u32) -> Self {
        Self { state: seed as u64 }
    }
    pub(crate) fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.state >> 32
    }
}

fn fade(t: f64) -> f64 { t * t * t * (t * (t * 6.0 - 15.0) + 10.0) }
fn lerp(a: f64, b: f64, t: f64) -> f64 { a + t * (b - a) }

/// 16 方向梯度
const GRAD_X: [f64; 16] = [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0];
const GRAD_Y: [f64; 16] = [1.0, 1.0, -1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 1.0, -1.0, 0.0, 0.0, 1.0, -1.0];

fn grad2d(hash: usize, x: f64, y: f64) -> f64 {
    let h = hash & 15;
    GRAD_X[h] * x + GRAD_Y[h] * y
}

/// 2D Perlin 噪声
pub fn perlin2d(x: f64, y: f64, perm: &[usize; 512]) -> f64 {
    let xi = x.floor() as isize & 255;
    let yi = y.floor() as isize & 255;
    let xf = x - x.floor();
    let yf = y - y.floor();
    let u = fade(xf);
    let v = fade(yf);

    let aa = perm[perm[xi as usize] + yi as usize];
    let ab = perm[perm[xi as usize] + yi as usize + 1];
    let ba = perm[perm[(xi + 1) as usize] + yi as usize];
    let bb = perm[perm[(xi + 1) as usize] + (yi + 1) as usize];

    let x1 = lerp(grad2d(aa, xf, yf), grad2d(ba, xf - 1.0, yf), u);
    let x2 = lerp(grad2d(ab, xf, yf - 1.0), grad2d(bb, xf - 1.0, yf - 1.0), u);
    lerp(x1, x2, v)
}

/// fBm — 输出范围 [-1, 1]
pub fn fbm(x: f64, y: f64, octaves: usize, lacunarity: f64, persistence: f64, perm: &[usize; 512]) -> f64 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = 1.0;
    let mut max_val = 0.0;

    for _ in 0..octaves {
        value += amplitude * perlin2d(x * frequency, y * frequency, perm);
        max_val += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    value / max_val
}

/// Ridged 多分形 — 输出范围 [0, 1]（始终非负）
pub fn ridged_multi(x: f64, y: f64, octaves: usize, perm: &[usize; 512]) -> f64 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = 1.0;
    let mut max_val = 0.0;

    for _ in 0..octaves {
        let n = perlin2d(x * frequency, y * frequency, perm);
        // Standard ridged noise: 1 - |n|, then squared for sharper ridges
        let signal = (1.0 - n.abs()).powi(2);

        value += amplitude * signal;
        max_val += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }

    value / max_val
}

/// ─── Perm 缓存（跨多次调用重用相同 seed 的 perm 表） ───
static PERM_CACHE: LazyLock<Mutex<HashMap<u32, [usize; 512]>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_perm(seed: u32) -> [usize; 512] {
    let mut cache = PERM_CACHE.lock().unwrap();
    *cache.entry(seed).or_insert_with(|| make_perm(seed))
}

/// ─── 高度图生成器 ───

pub struct HeightmapGenerator {
    pub seed: u32,
    pub island_mode: bool,
    pub perm: [usize; 512],
}

pub struct HeightmapParams {
    pub width: usize,
    pub height: usize,
    pub scale: f64,
    pub island_mode: bool,
    pub sea_level: f32,     // 目标海洋百分比（如 0.30 = 30% 海洋）
    pub seed: u32,
}

impl HeightmapGenerator {
    pub fn new(seed: u32, island_mode: bool) -> Self {
        let perm = get_perm(seed);
        Self { seed, island_mode, perm }
    }

    pub fn generate(&self, params: &HeightmapParams) -> Vec<f32> {
        let w = params.width as f64;
        let h = params.height as f64;
        let size = params.width * params.height;

        let mut raw_vals = Vec::with_capacity(size);

        // ── 1. 多层噪声合成 ──
        // 使用多个频段的噪声合成自然地形的原则：
        // - 极低频：大陆形状（决定整体地貌轮廓）
        // - 中频：丘陵起伏
        // - 中高频 ridges：山脉脊线
        // - 高频：微细节
        for y in 0..params.height {
            for x in 0..params.width {
                let nx = x as f64 / w;
                let ny = y as f64 / h;
                let px = nx * params.scale;
                let py = ny * params.scale;

                // 大陆形状（极低频 2 个 octaves）
                let continent = fbm(px * 0.25, py * 0.25, 2, 2.0, 0.5, &self.perm);
                // 地形起伏（中频 4 个 octaves）
                let terrain = fbm(px * 0.50, py * 0.50, 4, 2.0, 0.5, &self.perm);
                // 山脉脊线（4 个 octaves）
                let mountain = ridged_multi(px * 0.80, py * 0.80, 4, &self.perm);
                // 微细节（高频 3 个 octaves）
                let detail = fbm(px * 2.0, py * 2.0, 3, 2.0, 0.3, &self.perm);

                // 加权合成
                // continent ∈ [-1,1], terrain ∈ [-1,1], detail ∈ [-1,1], mountain ∈ [0,1]
                // mountain 权重取低以控制正偏
                let raw = continent * 0.50
                        + terrain * 0.25
                        + mountain * 0.08
                        + detail * 0.17;

                let value = if self.island_mode {
                    let cx = (nx - 0.5) * 2.0;
                    let cy = (ny - 0.5) * 2.0;
                    let dist2 = cx * cx + cy * cy;
                    // 线性径向衰减遮罩
                    let mask = 1.0 - (dist2 * 1.2).min(1.0);
                    // 边缘下拉至 -0.6
                    raw * mask + (1.0 - mask) * -0.6
                } else {
                    // 大陆模式：地图边缘下沉形成海岸线
                    let edge_dist = nx.min(ny).min(1.0 - nx).min(1.0 - ny); // [0, 0.5]
                    let edge_factor = (edge_dist * 3.0).min(1.0); // 靠近边缘 33% 范围衰减
                    if edge_factor < 1.0 {
                        raw * edge_factor + (1.0 - edge_factor) * -0.7
                    } else {
                        raw
                    }
                };

                raw_vals.push(value as f32);
            }
        }

        // ── 2. 归一化 [0, 1] ──
        let mut sorted = raw_vals.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let min_val = sorted[0];
        let max_val = sorted[size - 1];
        let range = max_val - min_val;
        if range <= 0.0 { return raw_vals; }

        for v in raw_vals.iter_mut() {
            *v = ((*v - min_val) / range) as f32;
        }

        // ── 3. 海平面处理 ──
        let sea_level = params.sea_level;

        if self.island_mode {
            // 岛屿模式：固定阈值（岛屿遮罩已自然地创造了海岸线）
            for v in raw_vals.iter_mut() {
                if *v < sea_level {
                    *v = *v / sea_level * 0.3;
                }
            }
        } else {
            // 大陆模式：百分位法——确保底部 sea_level 比例为海洋
            let sea_idx = ((size as f64) * sea_level as f64).round() as usize;
            let sea_idx = sea_idx.clamp(1, size - 1);
            let mut norm_sorted = raw_vals.clone();
            norm_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let ocean_cutoff = norm_sorted[sea_idx];

            for v in raw_vals.iter_mut() {
                if *v < ocean_cutoff {
                    // 海洋：线性映射 [0, ocean_cutoff] → [0, 0.04]
                    *v = (*v / ocean_cutoff) * 0.04;
                } else {
                    // 陆地：线性映射 [ocean_cutoff, 1] → [0.05, 1.0]
                    let t = (*v - ocean_cutoff) / (1.0 - ocean_cutoff);
                    *v = 0.05 + t * (1.0 - 0.05);
                }
            }
        }

        raw_vals
    }
}
