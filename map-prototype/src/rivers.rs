/// 河流折线提取 + Chaikin 平滑
///
/// 从 RiverNetwork 的像素掩码中提取矢量折线，
/// 应用 Chaikin corner-cutting 平滑，
/// 并按 Strahler 分级分配宽度。

use crate::hydrology::RiverNetwork;

/// 河流折线
#[derive(Debug, Clone)]
pub struct RiverPolyline {
    /// 折线顶点（像素坐标 [x, y]）
    pub waypoints: Vec<[f32; 2]>,
    /// Strahler 等级（1=源头小溪，2=溪流，3=河流）
    pub strahler: u32,
    /// 渲染宽度（像素）
    pub width_px: f32,
}

/// 从 RiverNetwork 提取河流折线
///
/// `min_strahler`：最小 Strahler 等级（1=全部，2=只保留溪流以上）
/// `short_river_min_len`：最短河流长度（像素，过滤噪声）
pub fn extract_river_polylines(
    rivers: &RiverNetwork,
    elevation: &[f32],
    width: usize,
    height: usize,
    ocean_threshold: f32,
    min_strahler: u32,
    short_river_min_len: usize,
) -> Vec<RiverPolyline> {
    let size = width * height;

    // 构建上游邻接表
    let mut upstream: Vec<Vec<usize>> = vec![vec![]; size];
    for i in 0..size {
        if let Some(parent) = rivers.flow_dir[i] {
            if rivers.river_mask[i] && rivers.river_mask[parent] {
                upstream[parent].push(i);
            }
        }
    }

    // 找到所有河口（河流像素中，没有下游河流的）
    let mut mouths: Vec<usize> = Vec::new();
    for i in 0..size {
        if !rivers.river_mask[i] {
            continue;
        }
        if rivers.strahler[i] < min_strahler {
            continue;
        }

        let is_mouth = match rivers.flow_dir[i] {
            Some(parent) => {
                !rivers.river_mask[parent]
                    || elevation[parent] < ocean_threshold
            }
            None => true,
        };

        if is_mouth {
            mouths.push(i);
        }
    }

    // 从每个河口向上游追踪
    let mut polylines: Vec<RiverPolyline> = Vec::new();
    let mut visited: Vec<bool> = vec![false; size];

    for &mouth in &mouths {
        // 深度优先遍历，从河口向上游回溯
        let mut stack: Vec<(usize, Vec<[f32; 2]>)> = Vec::new();
        stack.push((mouth, Vec::new()));

        while let Some((current, mut path)) = stack.pop() {
            // 将当前像素加入路径
            let cx = (current % width) as f32 + 0.5;
            let cy = (current / width) as f32 + 0.5;
            path.push([cx, cy]);

            // 收集上游（流入当前像素的）河流格子
            let children: Vec<usize> = upstream[current]
                .iter()
                .filter(|&&u| !visited[u])
                .copied()
                .collect();

            if children.is_empty() {
                // 到达源头 — 保存此折线
                if path.len() >= short_river_min_len {
                    // 取路径上的最大 Strahler 等级（而非叶节点的 1）
                    let strahler = path.iter()
                        .map(|p| {
                            let pi = (p[1] as usize) * width + (p[0] as usize);
                            rivers.strahler[pi]
                        })
                        .max()
                        .unwrap_or(1);
                    let width_px = strahler_width(strahler);

                    // 标记路径为已访问
                    for &p in &path {
                        let idx = (p[1] as usize) * width + (p[0] as usize);
                        visited[idx] = true;
                    }

                    // 平滑折线
                    let waypoints = if path.len() >= 3 {
                        chaikin_smooth(&path, 2)
                    } else {
                        path
                    };

                    polylines.push(RiverPolyline {
                        waypoints,
                        strahler,
                        width_px,
                    });
                }
            } else {
                // 有多个上游分支：复制路径，每个分支继续
                for &child in &children {
                    visited[child] = true;
                    stack.push((child, path.clone()));
                }
            }
        }
    }

    // 按 Strahler 升序排序（小溪先渲染，大河覆盖在上面）
    polylines.sort_by(|a, b| a.strahler.cmp(&b.strahler));
    polylines
}

/// Strahler 等级映射到像素宽度
fn strahler_width(order: u32) -> f32 {
    match order {
        1 => 1.8,
        2 => 3.5,
        3 => 5.5,
        4 => 8.0,
        5 => 11.0,
        _ => 14.0,
    }
}

/// Chaikin corner-cutting 平滑
///
/// 每轮：每条边 (A, B) → (A + 0.25*(B-A), A + 0.75*(B-A))
/// 首尾顶点保持不变。
fn chaikin_smooth(points: &[[f32; 2]], iterations: usize) -> Vec<[f32; 2]> {
    if points.len() < 3 {
        return points.to_vec();
    }

    let mut current = points.to_vec();

    for _iter in 0..iterations {
        if current.len() < 3 {
            break;
        }

        let mut next = Vec::with_capacity(current.len() * 2);
        // 保留首点
        next.push(current[0]);

        for i in 0..current.len() - 1 {
            let a = current[i];
            let b = current[i + 1];
            // Q = 1/4 A + 3/4 B
            // R = 3/4 A + 1/4 B
            let q = [
                a[0] * 0.75 + b[0] * 0.25,
                a[1] * 0.75 + b[1] * 0.25,
            ];
            let r = [
                a[0] * 0.25 + b[0] * 0.75,
                a[1] * 0.25 + b[1] * 0.75,
            ];
            next.push(q);
            next.push(r);
        }

        // 保留尾点
        next.push(current[current.len() - 1]);

        current = next;
    }

    current
}

/// 将河流折线渲染到像素缓冲区
///
/// 像素格式：RGB 连续排列，每个通道 u8
/// 河流颜色：蓝色（随 Strahler 加深）
pub fn render_river_polylines(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    polylines: &[RiverPolyline],
) {
    for polyline in polylines {
        let radius = (polyline.width_px / 2.0).ceil() as usize;

        // 河流颜色：Strailer 越高越深
        let (r, g, b) = match polyline.strahler {
            1 => (80, 140, 210),   // 浅蓝 — 小溪
            2 => (60, 110, 200),   // 中蓝 — 溪流
            3 => (40, 80, 190),    // 深蓝 — 河流
            _ => (20, 50, 180),    // 更深蓝 — 大河
        };

        // 对折线逐段渲染（Bresenham 画线）
        for i in 0..polyline.waypoints.len().saturating_sub(1) {
            let x0 = polyline.waypoints[i][0] as isize;
            let y0 = polyline.waypoints[i][1] as isize;
            let x1 = polyline.waypoints[i + 1][0] as isize;
            let y1 = polyline.waypoints[i + 1][1] as isize;

            bresenham_line(pixels, width, height, x0, y0, x1, y1, radius, r, g, b);
        }
    }
}

/// Bresenham 画线算法（带半径的粗线）
fn bresenham_line(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    x0: isize,
    y0: isize,
    x1: isize,
    y1: isize,
    radius: usize,
    r: u8,
    g: u8,
    b: u8,
) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;

    let (mut x, mut y) = (x0, y0);

    loop {
        // 绘制圆点（以 x,y 为中心的 radius 圆）
        fill_circle(pixels, width, height, x, y, radius, r, g, b);

        if x == x1 && y == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

/// 填充圆点
fn fill_circle(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    cx: isize,
    cy: isize,
    radius: usize,
    r: u8,
    g: u8,
    b: u8,
) {
    let radius = radius as isize;
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            if dx * dx + dy * dy <= radius * radius {
                let px = cx + dx;
                let py = cy + dy;
                if px >= 0 && px < width as isize && py >= 0 && py < height as isize {
                    let idx = ((py as usize) * width + (px as usize)) * 3;
                    if idx + 2 < pixels.len() {
                        pixels[idx] = r;
                        pixels[idx + 1] = g;
                        pixels[idx + 2] = b;
                    }
                }
            }
        }
    }
}
