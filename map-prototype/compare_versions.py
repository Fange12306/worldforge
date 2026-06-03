"""Compare v15 (old) vs v17 (new) to quantify actual differences"""
import struct, zlib

def read_png(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    ihdr = data.find(b'IHDR')
    w = struct.unpack('>I', data[ihdr+4:ihdr+8])[0]
    h = struct.unpack('>I', data[ihdr+8:ihdr+12])[0]
    raw = b''
    pos = data.find(b'IDAT')
    while pos >= 0:
        length = struct.unpack('>I', data[pos-4:pos])[0]
        raw += data[pos+4:pos+4+length]
        pos = data.find(b'IDAT', pos+4+length)
    dec = zlib.decompress(raw)
    bpp, stride = 3, w * 3 + 1
    row_data = [bytearray() for _ in range(h)]
    for y in range(h):
        offset = y * stride
        ft = dec[offset]
        flt = dec[offset+1:offset+stride]
        rr = bytearray(len(flt))
        for x in range(len(flt)):
            left = rr[x-bpp] if x >= bpp else 0
            above = row_data[y-1][x] if y > 0 else 0
            al = row_data[y-1][x-bpp] if y > 0 and x >= bpp else 0
            if ft == 0: rr[x] = flt[x]
            elif ft == 1: rr[x] = (flt[x] + left) & 0xFF
            elif ft == 2: rr[x] = (flt[x] + above) & 0xFF
            elif ft == 3: rr[x] = (flt[x] + (left+above)//2) & 0xFF
            elif ft == 4:
                p = left + above - al
                pa, pb, pc = abs(p-left), abs(p-above), abs(p-al)
                pr = left if pa <= pb and pa <= pc else (above if pb <= pc else al)
                rr[x] = (flt[x] + pr) & 0xFF
        row_data[y] = rr
    pixels = []
    for y in range(h):
        for x in range(w):
            off = x * bpp
            pixels.append((row_data[y][off], row_data[y][off+1], row_data[y][off+2]))
    return pixels, w, h

# Compare old (v15) vs new (v17) for continent mode
print("=" * 60)
print("v15 vs v17 对比分析 — seed777 大陆模式")
print("=" * 60)

# 1. Heightmap comparison
old_h, w, h = read_png("map-output-v15/seed777/01_heightmap.png")
new_h, _, _ = read_png("map-output-v17/seed777/01_heightmap.png")

# Count pixels that changed
changed = sum(1 for i in range(len(old_h)) if old_h[i] != new_h[i])
total = len(old_h)
print(f"\n1. 高度图差异:")
print(f"   变化像素: {changed} / {total} ({100*changed/total:.1f}%)")

# Compute average absolute difference (as grayscale values 0-255)
diff_sum = sum(abs(int(old_h[i][0]) - int(new_h[i][0])) for i in range(len(old_h)))
print(f"   平均灰度差: {diff_sum/total:.2f}")

# 2. Biome comparison
old_b, _, _ = read_png("map-output-v15/seed777/02_biomes.png")
new_b, _, _ = read_png("map-output-v17/seed777/02_biomes.png")

changed_b = sum(1 for i in range(len(old_b)) if old_b[i] != new_b[i])
print(f"\n2. 生物群落图差异:")
print(f"   变化像素: {changed_b} / {total} ({100*changed_b/total:.1f}%)")

# 3. River comparison
old_r, _, _ = read_png("map-output-v15/seed777/03_biomes_rivers.png")
new_r, _, _ = read_png("map-output-v17/seed777/03_biomes_rivers.png")

changed_r = sum(1 for i in range(len(old_r)) if old_r[i] != new_r[i])
print(f"\n3. 河流图差异:")
print(f"   变化像素: {changed_r} / {total} ({100*changed_r/total:.1f}%)")

# What colors changed?
old_river_colors = {}
new_river_colors = {}
for i in range(len(old_r)):
    if old_r[i] != old_b[i]:
        old_river_colors[old_r[i]] = old_river_colors.get(old_r[i], 0) + 1
    if new_r[i] != new_b[i]:
        new_river_colors[new_r[i]] = new_river_colors.get(new_r[i], 0) + 1

print(f"\n   旧版河流颜色 ({sum(old_river_colors.values())} px):")
for c, n in sorted(old_river_colors.items(), key=lambda x: -x[1])[:5]:
    print(f"     {c}: {n}")

print(f"   新版河流颜色 ({sum(new_river_colors.values())} px):")
for c, n in sorted(new_river_colors.items(), key=lambda x: -x[1])[:5]:
    print(f"     {c}: {n}")

# 4. File sizes
import os
for f in ["01_heightmap.png", "02_biomes.png", "03_biomes_rivers.png"]:
    old_sz = os.path.getsize(f"map-output-v15/seed777/{f}")
    new_sz = os.path.getsize(f"map-output-v17/seed777/{f}")
    print(f"\n   {f}: v15={old_sz}B v17={new_sz}B (diff={new_sz-old_sz:+d}B)")
