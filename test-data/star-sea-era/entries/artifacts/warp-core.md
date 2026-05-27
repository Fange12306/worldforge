---
id: "e0010203-0405-0607-0809-0a0b0c0d0e0c"
name: "跃迁核心"
type: "artifact"
properties:
  type: "能源装置"
  installed_on: "黎明号"
  power_output_zw: 12.7
  stability: 92
  manufacturer: "零号实验室"
relationships:
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e06"
    relation: "installed_on"
    properties:
      status: "定制匹配"
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e09"
    relation: "powers"
    properties:
      system: "跃迁引擎"
constraints:
  - rule: "跃迁核心的能源输出不能超过15泽瓦，否则有失控风险"
    severity: "hard"
tags: ["能源", "核心组件", "黎明号"]
timeline_summary:
  - period: [220, 222]
    state: "制造阶段"
    location: "e0010203-0405-0607-0809-0a0b0c0d0e04"
    summary: "为零号实验室为黎明号特制的跃迁核心"
  - period: [222, 250]
    state: "运行中"
    location: "e0010203-0405-0607-0809-0a0b0c0d0e06"
    summary: "持续为黎明号提供动力，运行稳定"
created_at: "2026-05-27T00:00:00+08:00"
updated_at: "2026-05-27T00:00:00+08:00"
---
# 跃迁核心

跃迁核心是星际时代最精密的工程造物。每一个核心都为其搭载的星舰量身定制——黎明号的跃迁核心能输出高达12.7泽瓦的能量，这足以让一座城市运转一年。

跃迁核心的工作原理涉及对时空膜的直接操控，关于其内部运作机制，只有零号实验室的核心团队知晓全部细节。这种极端的知识垄断引发了很多阴谋论：有些人认为核心中内置了联邦可以远程关闭的后门。

在林逸风叛逃后，联邦确实尝试通过某种方式远程关闭黎明号的跃迁核心。但尝试失败了——林逸风的工程师团队已经拆除了所有可疑的远程通信模块。
