/// D8 流量累积 + 河流提取（改进版：填洼 + 河流追踪确保连续性）

const DX: [isize; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY: [isize; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];

pub struct RiverNetwork {
    pub flow_dir: Vec<Option<usize>>,
    pub accumulation: Vec<f32>,
    pub river_mask: Vec<bool>,
    pub strahler: Vec<u32>,
}

fn idx(x: isize, y: isize, w: usize, h: usize) -> Option<usize> {
    if x >= 0 && x < w as isize && y >= 0 && y < h as isize {
        Some(y as usize * w + x as usize)
    } else {
        None
    }
}

/// 改进的 D8 流量累积
pub fn compute_flow_accumulation(
    elevation: &[f32],
    width: usize,
    height: usize,
    threshold_pct: f32,
    ocean_threshold: f32,
) -> RiverNetwork {
    let size = width * height;
    let mut elev = elevation.to_vec();
    let mut flow_dir: Vec<Option<usize>> = vec![None; size];
    let mut accumulation = vec![0.0f32; size];

    // ── Step 1: 确定初始流向 ──
    for y in 0..height {
        for x in 0..width {
            let i = y * width + x;
            if elev[i] < ocean_threshold { continue; } // 海洋跳过

            let mut min_elev = elev[i];
            let mut best: Option<usize> = None;

            for d in 0..8 {
                let nx = x as isize + DX[d];
                let ny = y as isize + DY[d];
                if let Some(ni) = idx(nx, ny, width, height) {
                    if elev[ni] < min_elev {
                        min_elev = elev[ni];
                        best = Some(ni);
                    }
                }
            }
            flow_dir[i] = best;
        }
    }

    // ── Step 2: 改进的填洼——从边缘向内地漫灌 ──
    // 策略：任何不能经由 flow_dir 链到达地图边缘的低点都是洼地
    // 使用多轮迭代：每轮找到所有 sink，抬升到最低邻居 + epsilon
    let mut changed = true;
    let mut iteration = 0;
    while changed && iteration < 100 {
        changed = false;
        iteration += 1;

        // 找到所有 sink（无下游的陆地格子）
        for y in 0..height {
            for x in 0..width {
                let i = y * width + x;
                if elev[i] < ocean_threshold { continue; }
                if flow_dir[i].is_some() { continue; }

                // 找最低的 8-邻域
                let mut min_nb = f32::MAX;
                let mut best: Option<usize> = None;
                for d in 0..8 {
                    let nx = x as isize + DX[d];
                    let ny = y as isize + DY[d];
                    if let Some(ni) = idx(nx, ny, width, height) {
                        if elev[ni] < min_nb {
                            min_nb = elev[ni];
                            best = Some(ni);
                        }
                    }
                }
                if let Some(bi) = best {
                    // 比最低邻居略高，确保水流方向明确
                    elev[i] = min_nb + 0.0001;
                    flow_dir[i] = Some(bi);
                    changed = true;
                }
            }
        }
    }

    // ── Step 3: 拓扑排序（从高到低）──
    let mut order: Vec<usize> = (0..size).collect();
    order.sort_by(|&a, &b| {
        elev[b].partial_cmp(&elev[a]).unwrap_or(std::cmp::Ordering::Equal)
    });

    // ── Step 4: 流量累积 ──
    for &i in &order {
        accumulation[i] += 1.0;
        if let Some(parent) = flow_dir[i] {
            accumulation[parent] += accumulation[i];
        }
    }

    // ── Step 5: 河流追踪（确保连续性）──
    // 先用累积量阈值选初始河流候选
    let max_acc = accumulation.iter().fold(0.0f32, |a, &b| a.max(b));
    let acc_threshold = max_acc * threshold_pct;

    // 基本河流掩码（累积量 > 阈值 且 > 1）
    let mut river_mask = vec![false; size];
    for i in 0..size {
        river_mask[i] = accumulation[i] >= acc_threshold && accumulation[i] > 1.0
            && elev[i] >= ocean_threshold;
    }

    // 河流连续性修复：从每条河流末端向上游追踪，但只标记累积量足够高的路径
    // 防止追踪淹没整个流域
    let trace_min_acc = (max_acc * threshold_pct * 0.05).max(2.0); // 追踪最低阈值
    let mut fixed_river = river_mask.clone();

    // 构建逆向邻接表：upstream[i] = 所有流向 i 的格子（仅陆地）
    let mut upstream: Vec<Vec<usize>> = vec![vec![]; size];
    for i in 0..size {
        if let Some(parent) = flow_dir[i] {
            if elev[i] >= ocean_threshold {
                upstream[parent].push(i);
            }
        }
    }

    // 找到所有河流末端（累积量最高的下游端点）
    let mut river_ends: Vec<usize> = Vec::new();
    for i in 0..size {
        if !river_mask[i] { continue; }
        let is_end = match flow_dir[i] {
            Some(parent) => {
                !river_mask[parent] || elev[parent] < ocean_threshold
            }
            None => true,
        };
        if is_end {
            river_ends.push(i);
        }
    }

    // 从河流末端向上游追踪，但只标记累积量 >= trace_min_acc 的路径
    for &end in &river_ends {
        let mut stack = vec![end];
        while let Some(current) = stack.pop() {
            if fixed_river[current] { continue; }
            fixed_river[current] = true;
            for &up in &upstream[current] {
                if elev[up] >= ocean_threshold
                    && !fixed_river[up]
                    && accumulation[up] >= trace_min_acc
                {
                    stack.push(up);
                }
            }
        }
    }

    // 额外步骤：从海岸线入河口反向追踪
    for y in 0..height {
        for x in 0..width {
            let i = y * width + x;
            if elev[i] >= ocean_threshold { continue; }

            for d in 0..8 {
                let nx = x as isize + DX[d];
                let ny = y as isize + DY[d];
                if let Some(ni) = idx(nx, ny, width, height) {
                    if elev[ni] >= ocean_threshold
                        && flow_dir[ni].is_some()
                        && accumulation[ni] >= trace_min_acc
                        && !fixed_river[ni]
                    {
                        // 检查是否流入海洋
                        if let Some(parent) = flow_dir[ni] {
                            if elev[parent] < ocean_threshold {
                                fixed_river[ni] = true;
                                let mut stack = vec![ni];
                                while let Some(current) = stack.pop() {
                                    for &up in &upstream[current] {
                                        if elev[up] >= ocean_threshold
                                            && !fixed_river[up]
                                            && accumulation[up] >= trace_min_acc
                                        {
                                            fixed_river[up] = true;
                                            stack.push(up);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    river_mask = fixed_river;

    // ── Step 6: Strahler 分级 ──
    let mut strahler = vec![0u32; size];
    let mut children: Vec<Vec<usize>> = vec![vec![]; size];

    // 只对河流像素建树：children[parent] = 所有流入 parent 的河流格子
    for i in 0..size {
        if river_mask[i] {
            if let Some(parent) = flow_dir[i] {
                if river_mask[parent] {
                    children[parent].push(i);
                }
            }
        }
    }

    // 按海拔从高到低处理（先处理上游支流，再处理下游干流）
    // order 是按海拔从高到低排序的，所以直接迭代 order
    for &i in &order {
        if !river_mask[i] { continue; }
        if children[i].is_empty() {
            strahler[i] = 1;
        } else {
            // 此时 children（上游）应该已经被处理过了
            let max_s = children[i].iter().map(|&c| strahler[c]).max().unwrap_or(0);
            let count_max = children[i].iter().filter(|&&c| strahler[c] == max_s).count();
            strahler[i] = if count_max >= 2 { max_s + 1 } else { max_s.max(1) };
        }
    }

    RiverNetwork { flow_dir, accumulation, river_mask, strahler }
}
