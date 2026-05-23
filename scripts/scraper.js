/**
 * 体彩超级大乐透历史开奖数据抓取脚本
 * 数据源：sporttery.cn 官方 API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
const GAME_NO = '85'; // 大乐透
const PAGE_SIZE = 100;
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'lottery_data.json');

function fetchPage(pageNo) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}?gameNo=${GAME_NO}&provinceId=0&pageSize=${PAGE_SIZE}&isVerify=1&pageNo=${pageNo}`;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.lottery.gov.cn/'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nResponse: ${data.substring(0, 500)}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseDrawResult(item) {
  // lotteryDrawResult format: "01 05 10 22 35 02 09"
  // first 5 are front zone, last 2 are back zone
  const numbers = item.lotteryDrawResult.trim().split(/\s+/).map(Number);
  
  return {
    issue: item.lotteryDrawNum,
    date: item.lotteryDrawTime ? item.lotteryDrawTime.split(' ')[0] : '',
    front: numbers.slice(0, 5),
    back: numbers.slice(5, 7),
    sales: item.totalSaleAmount ? parseInt(item.totalSaleAmount.replace(/,/g, '')) : null,
    pool: item.poolBalanceAfterdraw ? parseInt(item.poolBalanceAfterdraw.replace(/,/g, '')) : null
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAll() {
  console.log('🎰 开始抓取体彩超级大乐透历史开奖数据...\n');
  
  const allResults = [];
  let pageNo = 1;
  let totalPages = 1;
  
  try {
    // First page to get total count
    console.log(`📄 正在获取第 ${pageNo} 页...`);
    const firstPage = await fetchPage(pageNo);
    
    if (!firstPage || firstPage.errorCode !== '0' || !firstPage.value) {
      throw new Error(`API 返回错误: ${JSON.stringify(firstPage).substring(0, 500)}`);
    }
    
    const totalCount = firstPage.value.total || 0;
    totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    console.log(`📊 共 ${totalCount} 期数据，${totalPages} 页\n`);
    
    // Parse first page
    const list = firstPage.value.list || [];
    for (const item of list) {
      allResults.push(parseDrawResult(item));
    }
    console.log(`  ✅ 第 ${pageNo} 页: ${list.length} 条记录`);
    
    // Fetch remaining pages
    for (pageNo = 2; pageNo <= totalPages; pageNo++) {
      await sleep(300); // Rate limiting
      console.log(`📄 正在获取第 ${pageNo}/${totalPages} 页...`);
      
      const page = await fetchPage(pageNo);
      if (page && page.errorCode === '0' && page.value && page.value.list) {
        const items = page.value.list;
        for (const item of items) {
          allResults.push(parseDrawResult(item));
        }
        console.log(`  ✅ 第 ${pageNo} 页: ${items.length} 条记录`);
      } else {
        console.warn(`  ⚠️ 第 ${pageNo} 页获取失败，跳过`);
      }
    }
    
    // Sort by issue number descending (newest first)
    allResults.sort((a, b) => {
      const issueA = parseInt(a.issue);
      const issueB = parseInt(b.issue);
      return issueB - issueA;
    });
    
    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Save to file
    const output = {
      updateTime: new Date().toISOString(),
      total: allResults.length,
      data: allResults
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
    
    console.log(`\n🎉 抓取完成！共获取 ${allResults.length} 期数据`);
    console.log(`💾 数据已保存到: ${OUTPUT_FILE}`);
    
    // Print latest 5 results
    console.log('\n📋 最近 5 期开奖结果:');
    for (const r of allResults.slice(0, 5)) {
      console.log(`  第 ${r.issue} 期 (${r.date}): 前区 [${r.front.join(', ')}] 后区 [${r.back.join(', ')}]`);
    }
    
  } catch (error) {
    console.error(`\n❌ 抓取失败: ${error.message}`);
    
    // If we have partial data, save it
    if (allResults.length > 0) {
      const dataDir = path.dirname(OUTPUT_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const output = {
        updateTime: new Date().toISOString(),
        total: allResults.length,
        partial: true,
        data: allResults
      };
      
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
      console.log(`\n⚠️ 已保存部分数据 (${allResults.length} 期) 到: ${OUTPUT_FILE}`);
    }
    
    process.exit(1);
  }
}

scrapeAll();
