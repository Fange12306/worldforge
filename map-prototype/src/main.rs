mod heightmap;
mod biomes;
mod hydrology;
mod render;
mod erosion;
mod rain_shadow;
mod rivers;
mod biome_smoothing;

use std::path::PathBuf;
use heightmap::{HeightmapGenerator, HeightmapParams};
use biomes::BiomeClassifier;
use hydrology::compute_flow_accumulation;
use erosion::{ErosionParams, hydraulic_erosion};
use rain_shadow::compute_rain_shadow_default;
use rivers::extract_river_polylines;
use biome_smoothing::smooth_biomes_default;
use render::{save_heightmap, save_biomes, save_biomes_rivers_polylines};

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();

    let seed: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(42);
    let map_size: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(512);
    let island: bool = args.get(3).map(|s| s == "island").unwrap_or(true);
    let out_dir = PathBuf::from(args.get(4).map(|s| s.as_str()).unwrap_or("output"));

    // 可选：侵蚀开关（默认开启）
    let enable_erosion: bool = args.get(5).map(|s| s != "no-erosion").unwrap_or(true);

    std::fs::create_dir_all(&out_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    println!("═══ WorldForge Map Prototype v17 ═══");
    println!("Seed:     {}", seed);
    println!("Size:     {}×{}", map_size, map_size);
    println!("Mode:     {}", if island { "岛屿" } else { "大陆" });
    println!("Erosion:  {}", if enable_erosion { "开启" } else { "关闭" });
    println!("Output:   {}", out_dir.display());
    println!();

    // ── Phase 1: 高度图 ──
    println!("[1/8] 生成高度图...");
    let h_gen = HeightmapGenerator::new(seed, island);
    let sea_level: f32 = if island { 0.08 } else { 0.30 };
    let h_params = HeightmapParams {
        width: map_size,
        height: map_size,
        scale: 4.0,
        island_mode: island,
        sea_level,
        seed,
    };
    let mut elevation = h_gen.generate(&h_params);

    // 陆海分界
    let ocean_threshold = 0.05;

    // ── Phase 2: 水力侵蚀 ──
    if enable_erosion {
        let sum_before: f32 = elevation.iter().sum();

        let erosion_params = ErosionParams {
            drop_count: 200_000,
            erosion_rate: 0.05,
            deposition_rate: 0.05,
            sediment_capacity: 20.0,
            evaporation_rate: 0.01,
            gravity: 4.0,
            max_steps: 80,
            min_slope: 0.001,
        };
        println!("[2/8] 水力侵蚀（{} drops）...", erosion_params.drop_count);
        hydraulic_erosion(&mut elevation, map_size, map_size, seed, &erosion_params);

        let sum_after: f32 = elevation.iter().sum();
        let total_change = (sum_after - sum_before).abs();
        let avg_change = total_change / elevation.len() as f32;
        println!("  高度变化: 总计={:.4}, 平均={:.6}", total_change, avg_change);
    } else {
        println!("[2/8] 跳过水力侵蚀");
    }

    let hp = out_dir.join("01_heightmap.png");
    save_heightmap(&elevation, map_size as u32, map_size as u32, &hp.to_string_lossy())?;
    println!("  → {}", hp.display());

    // ── Phase 3: 水流累积 ──
    println!("[3/8] 计算河流网络...");
    let river_threshold = if island { 0.01 } else { 0.018 };
    let rivers = compute_flow_accumulation(&elevation, map_size, map_size, river_threshold, ocean_threshold);

    let river_count = rivers.river_mask.iter().filter(|&&b| b).count();
    let total = map_size * map_size;
    println!("  河流像素: {} ({:.2}%)", river_count, river_count as f64 / total as f64 * 100.0);

    // ── Phase 4: 雨影效应 ──
    println!("[4/8] 计算雨影效应...");
    let precipitation = compute_rain_shadow_default(&elevation, map_size, map_size, ocean_threshold);
    println!("  降水范围: {:.3} ~ {:.3}",
        precipitation.values.iter().fold(1.0f32, |a, &b| a.min(b)),
        precipitation.values.iter().fold(0.0f32, |a, &b| a.max(b)));

    // ── Phase 5: 生物群落分类 ──
    println!("[5/8] 分类生物群落（含雨影修正）...");
    let classifier = BiomeClassifier::new(seed);
    let biomes = classifier.classify_with_precipitation(
        &elevation, &precipitation.values, map_size, map_size, 4.0, ocean_threshold,
    );

    // 统计
    let mut counts = vec![0usize; 16];
    for &b in &biomes {
        counts[b as usize] += 1;
    }
    println!("  生物群落分布:");
    for (i, &count) in counts.iter().enumerate() {
        if count > 0 {
            let pct = count as f64 / total as f64 * 100.0;
            println!("    {:>4.1}%  {}", pct, biomes::BIOME_NAMES.get(i).unwrap_or(&"Unknown"));
        }
    }

    // ── Phase 6: 生物群落平滑 ──
    println!("[6/8] 生物群落平滑（众数滤波）...");
    let smooth_biomes = smooth_biomes_default(&biomes, &elevation, map_size, map_size, ocean_threshold);

    let bp = out_dir.join("02_biomes.png");
    save_biomes(&smooth_biomes, map_size as u32, map_size as u32, &bp.to_string_lossy())?;
    println!("  → {}", bp.display());

    // ── Phase 7: 河流折线提取 ──
    println!("[7/8] 提取河流折线...");
    let polylines = extract_river_polylines(
        &rivers, &elevation, map_size, map_size, ocean_threshold, 1, 3,
    );
    println!("  折线数: {}", polylines.len());

    let rp = out_dir.join("03_biomes_rivers.png");
    save_biomes_rivers_polylines(&smooth_biomes, &polylines, map_size as u32, map_size as u32, &rp.to_string_lossy())?;
    println!("  → {}", rp.display());

    // ── Phase 8: 导出 JSON ──
    println!("[8/8] 导出地图数据...");

    let land_pixels = elevation.iter().filter(|&&e| e >= ocean_threshold).count();
    let ocean_pixels = total - land_pixels;
    let avg_elev = elevation.iter().filter(|&&e| e >= ocean_threshold).copied().sum::<f32>() / land_pixels.max(1) as f32;
    let min_elev = elevation.iter().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();
    let max_elev = elevation.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();

    let summary = serde_json::json!({
        "version": 2,
        "seed": seed,
        "width": map_size,
        "height": map_size,
        "island": island,
        "erosion": enable_erosion,
        "pixels": {
            "total": total,
            "land": land_pixels,
            "ocean": ocean_pixels,
        },
        "elevation": {
            "avg": format!("{:.3}", avg_elev),
            "min": format!("{:.3}", min_elev),
            "max": format!("{:.3}", max_elev),
        },
        "rivers": {
            "pixels": river_count,
            "strahler_max": rivers.strahler.iter().max().unwrap_or(&0),
            "polylines": polylines.len(),
        },
        "precipitation": {
            "min": format!("{:.3}", precipitation.values.iter().fold(1.0f32, |a, &b| a.min(b))),
            "max": format!("{:.3}", precipitation.values.iter().fold(0.0f32, |a, &b| a.max(b))),
        },
    });

    let jp = out_dir.join("map_data.json");
    let json_str = serde_json::to_string_pretty(&summary).map_err(|e| format!("JSON 序列化失败: {}", e))?;
    std::fs::write(&jp, &json_str).map_err(|e| format!("写入 JSON 失败: {}", e))?;
    println!("  → {}", jp.display());

    println!();
    println!("✅ 完成！");

    Ok(())
}
