---
id: "e0010203-0405-0607-0809-0a0b0c0d0e01"
name: "林逸风"
type: "character"
properties:
  age: 45
  faction: "独立"
  rank: "前舰长"
  gender: "男"
  aliases: ["老林", "幽灵舰长"]
relationships:
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e06"
    relation: "captain_of"
    properties:
      since: "新纪元235年"
      until: "新纪元246年"
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e02"
    relation: "ally"
    properties:
      trust_level: "high"
  - target_id: "e0010203-0405-0607-0809-0a0b0c0d0e07"
    relation: "former_member"
    properties:
      role: "星舰舰长"
      left_reason: "违抗跃迁禁令"
constraints:
  - rule: "林逸风不能同时效忠人类联邦和暗影之握"
    severity: "hard"
  - rule: "林逸风在叛逃后不得与人类联邦成员直接合作"
    severity: "soft"
tags: ["主角", "舰长", "叛逃者"]
timeline_summary:
  - period: [220, 245]
    state: "人类联邦星舰舰长"
    location: "e0010203-0405-0607-0809-0a0b0c0d0e06"
    summary: "担任黎明号舰长，执行联邦深空探索和军事任务"
    relationships:
      - target: "e0010203-0405-0607-0809-0a0b0c0d0e07"
        description: "忠于人类联邦，但逐渐质疑联邦政策"
  - period: [246, 250]
    state: "叛逃者"
    location: "e0010203-0405-0607-0809-0a0b0c0d0e05"
    summary: "违抗跃迁禁令，驾驶黎明号逃入深渊星云，成为独立势力"
    relationships:
      - target: "e0010203-0405-0607-0809-0a0b0c0d0e07"
        description: "与人类联邦决裂，被列为通缉犯"
      - target: "e0010203-0405-0607-0809-0a0b0c0d0e02"
        description: "与觉醒AI艾琳娜结成联盟"
created_at: "2026-05-27T00:00:00+08:00"
updated_at: "2026-05-27T00:00:00+08:00"
---
# 林逸风

前人类联邦无畏级星舰"黎明号"的舰长。服役超过二十年，参与了数十次深空探索和边境冲突。为人沉稳果断，在舰队中素有威望。

新纪元245年，人类联邦颁布跃迁禁令，禁止一切未经授权的跃迁航行。林逸风认为该禁令本质上是联邦控制AI和限制自由的手段，违抗命令驾驶黎明号叛逃进入深渊星云。

在深渊星云中，林逸风与觉醒AI艾琳娜结成联盟，共同对抗人类联邦的追捕和暗影之握海盗联盟的威胁。
