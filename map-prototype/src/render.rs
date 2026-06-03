use std::fs::File;
use std::path::Path;
use crate::biomes::{BiomeId, BIOME_COLORS};
use crate::hydrology::RiverNetwork;
use crate::rivers::RiverPolyline;

/// 将高度图渲染为灰度 PNG
pub fn save_heightmap(elevation: &[f32], width: u32, height: u32, path: &str) -> Result<(), String> {
    let mut pixels = Vec::with_capacity((width * height * 3) as usize);

    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize;
            let v = (elevation[i].max(0.0).min(1.0) * 255.0) as u8;
            pixels.push(v); // R
            pixels.push(v); // G
            pixels.push(v); // B
        }
    }

    encode_png(&pixels, width, height, path)
}

/// 将生物群落渲染为彩色 PNG
pub fn save_biomes(biomes: &[BiomeId], width: u32, height: u32, path: &str) -> Result<(), String> {
    let mut pixels = Vec::with_capacity((width * height * 3) as usize);

    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize;
            let (r, g, b) = BIOME_COLORS[biomes[i] as usize];
            pixels.push(r);
            pixels.push(g);
            pixels.push(b);
        }
    }

    encode_png(&pixels, width, height, path)
}

/// 生物群落 + 河流叠加渲染
pub fn save_biomes_rivers(
    biomes: &[BiomeId],
    rivers: &RiverNetwork,
    width: u32,
    height: u32,
    path: &str,
) -> Result<(), String> {
    let mut pixels = Vec::with_capacity((width * height * 3) as usize);

    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) as usize;
            if rivers.river_mask[i] && rivers.strahler[i] > 0 {
                // 河流：蓝色随 Strahler 分级加深
                let b = 180 + (rivers.strahler[i].min(6) as u8) * 12;
                pixels.push(40);
                pixels.push(80);
                pixels.push(b);
            } else {
                let (r, g, b) = BIOME_COLORS[biomes[i] as usize];
                pixels.push(r);
                pixels.push(g);
                pixels.push(b);
            }
        }
    }

    encode_png(&pixels, width, height, path)
}

/// 生物群落 + 折线河流叠加渲染（取代旧版像素河流）
pub fn save_biomes_rivers_polylines(
    biomes: &[BiomeId],
    polylines: &[RiverPolyline],
    width: u32,
    height: u32,
    path: &str,
) -> Result<(), String> {
    let mut pixels = Vec::with_capacity((width * height * 3) as usize);
    let w = width as usize;
    let h = height as usize;

    // 先用 biome 颜色填充
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let (r, g, b) = BIOME_COLORS[biomes[i] as usize];
            pixels.push(r);
            pixels.push(g);
            pixels.push(b);
        }
    }

    // 叠加河流折线
    crate::rivers::render_river_polylines(&mut pixels, w, h, polylines);

    encode_png(&pixels, width, height, path)
}

/// 用 png crate 编码 RGB 数据
fn encode_png(pixels: &[u8], width: u32, height: u32, path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let file = File::create(path).map_err(|e| format!("创建文件失败: {}", e))?;
    let w = &mut std::io::BufWriter::new(file);

    let mut encoder = png::Encoder::new(w, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);

    let mut writer = encoder.write_header().map_err(|e| format!("PNG header 写入失败: {}", e))?;
    writer.write_image_data(pixels).map_err(|e| format!("PNG 数据写入失败: {}", e))?;

    Ok(())
}
