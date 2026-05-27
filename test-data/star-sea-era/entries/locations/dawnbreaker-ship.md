---
id: "e0010203-0405-0607-0809-0a0b0c0d0e06"
name: "黎明号"
type: "location"
properties:
  type: "星舰"
  class: "无畏级"
  length_m: 2400
  crew_capacity: 3000
  armament: ["等离子主炮", "量子鱼雷", "相位护盾"]
  captain: "林逸风"
relationships:
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e0c"
    relation: "powered_by"
    properties:
      power_output: "12.7泽瓦"
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e01"
    relation: "commanded_by"
    properties:
      captain_since: "新纪元235年"
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e05"
    relation: "hiding_in"
    properties:
      since: "新纪元246年"
constraints:
  - rule: "黎明号需要跃迁核心才能进行超光速航行"
    severity: "hard"
tags: ["传奇星舰", "无畏级", "移动基地"]
timeline_summary:
  - period: [222, 246]
    state: "联邦现役旗舰"
    summary: "人类联邦最强大的无畏级星舰，执行重要军事和外交任务"
  - period: [246, 250]
    state: "叛逃/独立"
    location: "e0010203-0405-0607-0809-0a0b0c0d0e05"
    summary: "随林逸风叛逃，在深渊星云中作为移动基地运作"
created_at: "2026-05-27T00:00:00+08:00"
updated_at: "2026-05-27T00:00:00+08:00"
---
# 黎明号

人类联邦建造的第七艘无畏级星舰，也是迄今为止最强大的一艘。全长2400米，配备等离子主炮和最新一代相位护盾，理论上可以单独对抗一支小型舰队。

黎明号的核心是跃迁核心——一个能产生巨大能量并在时空中撕开裂隙的装置。没有这个核心，黎明号只是一艘普通的重型巡洋舰。

在叛逃事件后，黎明号经历了重大改装。林逸风的船员移除了所有联邦追踪装置，并用深渊星云中获取的材料对护盾系统进行了独特的升级。如今的黎明号已成为深渊星云中最不可忽视的力量。
