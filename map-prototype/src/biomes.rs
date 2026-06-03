use crate::heightmap;

/// 生物群落类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BiomeId {
    Ocean = 0,
    Beach = 1,
    HotDesert = 2,
    ColdDesert = 3,
    Savanna = 4,
    Grassland = 5,
    Shrubland = 6,
    TemperateDeciduousForest = 7,
    TemperateRainforest = 8,
    TropicalSeasonalForest = 9,
    TropicalRainforest = 10,
    BorealForest = 11,
    Taiga = 12,
    Tundra = 13,
    Glacier = 14,
}

pub const BIOME_COLORS: &[(u8, u8, u8)] = &[
    (25, 60, 120),   // 0 Ocean — deep blue
    (210, 190, 140), // 1 Beach — tan
    (240, 220, 130), // 2 HotDesert — light sand
    (220, 200, 180), // 3 ColdDesert — pale brown
    (180, 200, 80),  // 4 Savanna — yellow-green
    (130, 180, 70),  // 5 Grassland — light green
    (140, 150, 60),  // 6 Shrubland — olive
    (80, 140, 60),   // 7 TemperateDeciduousForest — mid green
    (60, 120, 80),   // 8 TemperateRainforest — dark green
    (100, 160, 50),  // 9 TropicalSeasonalForest — bright green
    (30, 100, 40),   // 10 TropicalRainforest — deep green
    (60, 90, 70),    // 11 BorealForest — pine green
    (40, 70, 60),    // 12 Taiga — dark pine
    (120, 130, 110), // 13 Tundra — grey-green
    (220, 220, 230), // 14 Glacier — white
];

pub const BIOME_NAMES: &[&str] = &[
    "Ocean", "Beach", "Hot Desert", "Cold Desert", "Savanna",
    "Grassland", "Shrubland", "Temperate Deciduous Forest",
    "Temperate Rainforest", "Tropical Seasonal Forest",
    "Tropical Rainforest", "Boreal Forest", "Taiga",
    "Tundra", "Glacier",
];

/// 生物群落分类器
pub struct BiomeClassifier {
    seed: u32,
    perm: [usize; 512],
}

impl BiomeClassifier {
    pub fn new(seed: u32) -> Self {
        let perm = heightmap::make_perm(seed.wrapping_add(100));
        Self { seed, perm }
    }

    /// 对每个像素分类，返回 biome_id 网格
    pub fn classify(
        &self,
        elevation: &[f32],
        width: usize,
        height: usize,
        scale: f64,
        ocean_threshold: f32,
    ) -> Vec<BiomeId> {
        let mut biomes = Vec::with_capacity(elevation.len());

        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let elev = elevation[idx];
                let nx = x as f64 / width as f64;
                let ny = y as f64 / height as f64;
                let px = nx * scale;
                let py = ny * scale;

                // 湿度：单层 Perlin 噪声（单 octave 分布更宽，极端值更常见）
                // 多层 fbm 过度平滑使极端值几乎消失，而实际气候带是大型斑块状的
                let moisture = heightmap::perlin2d(px * 1.2, py * 1.2, &self.perm);
                // 略微放大噪声幅度再 clamp，让两端极端值更常见
                let moist = (moisture * 0.6 + 0.5).clamp(0.0, 1.0);

                // 温度（纬度为主 + 噪声扰动 + 海拔递减）
                // ny = 0 顶部（寒冷），ny = 1 底部（温暖）
                let lat_factor = ny; // 0.0 到 1.0
                let temp_base = heightmap::fbm(px * 0.8, py * 0.8, 3, 2.0, 0.5, &self.perm);
                let temp_noise = (temp_base + 1.0) / 2.0 * 0.3; // 噪声扰动 ±0.15
                let base_temp = lat_factor * 0.85 + 0.05; // 底部 0.9，顶部 0.05
                // 海拔递减率：每升高 0.1 降 0.03
                let elev_lapse = (elev as f64).max(0.0) * 0.3;
                let temp = (base_temp + temp_noise - elev_lapse).clamp(0.0, 1.0);

                let biome = Self::whittaker(elev, temp as f32, moist as f32, ocean_threshold);
                biomes.push(biome);
            }
        }

        biomes
    }

    /// 用外部降水量数据分类生物群落（替代纯噪声湿度）
    ///
    /// `precipitation` 来自雨影模型，取值范围 [0, 1]。
    /// 最终湿度 = 噪声基底 × 降水量因子。
    pub fn classify_with_precipitation(
        &self,
        elevation: &[f32],
        precipitation: &[f32],
        width: usize,
        height: usize,
        scale: f64,
        ocean_threshold: f32,
    ) -> Vec<BiomeId> {
        let mut biomes = Vec::with_capacity(elevation.len());

        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let elev = elevation[idx];
                let nx = x as f64 / width as f64;
                let ny = y as f64 / height as f64;
                let px = nx * scale;
                let py = ny * scale;

                // 湿度：噪声基底 × 降水量
                let moisture_noise = heightmap::perlin2d(px * 1.2, py * 1.2, &self.perm);
                let moisture_base = (moisture_noise * 0.6 + 0.5).clamp(0.0, 1.0);
                // 降水量压缩湿度范围，但不完全消除噪声变化
                let moist = moisture_base * (0.3 + precipitation[idx] as f64 * 0.7);

                // 温度（纬度为主 + 噪声扰动 + 海拔递减）
                let lat_factor = ny;
                let temp_base = heightmap::fbm(px * 0.8, py * 0.8, 3, 2.0, 0.5, &self.perm);
                let temp_noise = (temp_base + 1.0) / 2.0 * 0.3;
                let base_temp = lat_factor * 0.85 + 0.05;
                let elev_lapse = (elev as f64).max(0.0) * 0.3;
                let temp = (base_temp + temp_noise - elev_lapse).clamp(0.0, 1.0);

                let biome = Self::whittaker(elev, temp as f32, moist as f32, ocean_threshold);
                biomes.push(biome);
            }
        }

        biomes
    }

    /// Whittaker 生物群落分类（改进版：阈值放宽以增加多样性）
    fn whittaker(elevation: f32, temperature: f32, moisture: f32, ocean_threshold: f32) -> BiomeId {
        if elevation < ocean_threshold { return BiomeId::Ocean; }
        if elevation < ocean_threshold * 1.5 { return BiomeId::Beach; }
        if elevation > 0.85 { return BiomeId::Glacier; }

        match (temperature, moisture) {
            (t, _) if t > 0.8 && moisture < 0.2 => BiomeId::HotDesert,
            (t, _) if t < 0.2 && moisture < 0.3 && elevation > 0.4 => BiomeId::ColdDesert,
            // 热带（t > 0.6）
            (t, m) if t > 0.6 && m > 0.7 => BiomeId::TropicalRainforest,
            (t, m) if t > 0.6 && m > 0.4 => BiomeId::TropicalSeasonalForest,
            (t, _) if t > 0.6 => BiomeId::Savanna,
            // 温带（0.35 < t ≤ 0.6）
            (t, m) if t > 0.45 && m > 0.6 => BiomeId::TemperateRainforest,
            (t, m) if t > 0.35 && m > 0.45 => BiomeId::TemperateDeciduousForest,
            (t, m) if t > 0.35 && m > 0.25 => BiomeId::Shrubland,
            (t, _) if t > 0.35 => BiomeId::Grassland,
            // 寒带（t ≤ 0.35）
            (t, m) if t > 0.2 && m > 0.5 => BiomeId::BorealForest,
            (t, _) if t > 0.2 => BiomeId::Taiga,
            (t, m) if t > 0.05 && m > 0.3 => BiomeId::Tundra,
            (_, _) => BiomeId::Glacier,
        }
    }
}
