import os
import re
import json
from datetime import datetime, timezone

CUSTOM_CN_MAP = {
    '墨西哥': 'Mexico',
    '南非': 'South Africa',
    '韩国': 'South Korea',
    '捷克': 'Czech Republic',
    '加拿大': 'Canada',
    '波黑': 'Bosnia-Herzegovina',
    '卡塔尔': 'Qatar',
    '瑞士': 'Switzerland',
    '巴西': 'Brazil',
    '摩洛哥': 'Morocco',
    '海地': 'Haiti',
    '苏格兰': 'Scotland',
    '美国': 'USA',
    '巴拉圭': 'Paraguay',
    '澳大利亚': 'Australia',
    '土耳其': 'Turkey',
    '德国': 'Germany',
    '库拉索': 'Curaçao',
    '科特迪瓦': 'Ivory Coast',
    '厄瓜多尔': 'Ecuador',
    '荷兰': 'Netherlands',
    '日本': 'Japan',
    '瑞典': 'Sweden',
    '突尼斯': 'Tunisia',
    '比利时': 'Belgium',
    '埃及': 'Egypt',
    '伊朗': 'Iran',
    '新西兰': 'New Zealand',
    '西班牙': 'Spain',
    '佛得角': 'Cape Verde',
    '沙特阿拉伯': 'Saudi Arabia',
    '乌拉圭': 'Uruguay',
    '法国': 'France',
    '塞内加尔': 'Senegal',
    '伊拉克': 'Iraq',
    '挪威': 'Norway',
    '阿根廷': 'Argentina',
    '阿尔及利亚': 'Algeria',
    '奥地利': 'Austria',
    '约旦': 'Jordan',
    '葡萄牙': 'Portugal',
    '刚果': 'DR Congo',
    '乌兹别克斯坦': 'Uzbekistan',
    '哥伦比亚': 'Colombia',
    '英格兰': 'England',
    '克罗地亚': 'Croatia',
    '加纳': 'Ghana',
    '巴拿马': 'Panama'
}

def parse_ics():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ics_path = os.path.join(base_dir, 'data', 'WorldCupSchedule.ics')
    output_path = os.path.join(base_dir, 'data', 'worldcup_matches.json')
    
    with open(ics_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    events = re.findall(r'BEGIN:VEVENT(.*?)END:VEVENT', content, re.DOTALL)
    
    groups = {chr(ord('A') + i): {"teams": [], "matches": []} for i in range(12)}
    
    match_count = 0
    
    for event in events:
        desc_match = re.search(r'DESCRIPTION:(.*)', event)
        if not desc_match:
            continue
        desc = desc_match.group(1).replace(r'\n', '\n')
        
        if '阶段: 小组赛' not in desc:
            continue
            
        summary_match = re.search(r'SUMMARY:(.*)', event)
        if not summary_match:
            continue
        summary = summary_match.group(1).strip()
        
        # summary format: A组-墨西哥🇲🇽vs南非🇿🇦
        m = re.match(r'^([A-L])组-(.+)vs(.+)$', summary)
        if not m:
            continue
            
        group_label = m.group(1)
        home_raw = m.group(2)
        away_raw = m.group(3)
        
        home = None
        away = None
        for cn, en in CUSTOM_CN_MAP.items():
            if cn in home_raw:
                home = en
            if cn in away_raw:
                away = en
                
        if not home or not away:
            print(f"Skipping match {summary} due to unmapped teams")
            continue
            
        dtstart_match = re.search(r'DTSTART:(.*)', event)
        if not dtstart_match:
            continue
        dtstart = dtstart_match.group(1).strip() # format: 20260611T190000Z
        
        # Parse UTC time
        # 20260611T190000Z -> date: 2026-06-11, time: 19:00
        match_date = f"{dtstart[0:4]}-{dtstart[4:6]}-{dtstart[6:8]}"
        match_time = f"{dtstart[9:11]}:{dtstart[11:13]}"
        
        match_day = 1
        md_match = re.search(r'轮次: 第(\d)轮', desc)
        if md_match:
            match_day = int(md_match.group(1))
            
        # Ensure teams list is populated
        if home not in groups[group_label]["teams"]:
            groups[group_label]["teams"].append(home)
        if away not in groups[group_label]["teams"]:
            groups[group_label]["teams"].append(away)
            
        match_id = f"{group_label.lower()}-md{match_day}-{len(groups[group_label]['matches'])+1}"
        
        groups[group_label]["matches"].append({
            "id": match_id,
            "group": group_label,
            "matchDay": match_day,
            "date": match_date,
            "time": match_time,
            "venue": "FIFA Official Stadium",
            "home": home,
            "away": away,
            "homeScore": None,
            "awayScore": None,
            "status": "scheduled"
        })
        
        match_count += 1

    # Sort matches in each group by date/time
    for label in groups:
        groups[label]["matches"].sort(key=lambda m: (m["date"], m["time"]))
        
    now = datetime.now(timezone.utc)
    output = {
        "metadata": {
            "lastUpdated": now.isoformat(),
            "generatedBy": "scripts/parse_ics.py",
            "sourceDataDate": "2026-04-02",
            "note": "Official 2026 World Cup Group Stage Schedule",
            "teamCount": 48,
            "matchCount": match_count
        },
        "groups": groups
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        
    print(f"Parsed {match_count} group stage matches into {output_path}")

if __name__ == '__main__':
    parse_ics()
