/**
 * 体彩超级大乐透历史开奖数据抓取脚本
 * 主源：JisuAPI
 * 副源：sporttery.cn 官方 API
 */

const path = require('path');
const {
  createJisuSource,
  createOfficialSource,
  runDualSourceScrape
} = require('./lottery_scraper_common');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'lottery_data.json');

function parseOfficialItem(item) {
  const numbers = item.lotteryDrawResult.trim().split(/\s+/).map(Number);
  return {
    issue: item.lotteryDrawNum,
    date: item.lotteryDrawTime ? item.lotteryDrawTime.split(' ')[0] : '',
    front: numbers.slice(0, 5),
    back: numbers.slice(5, 7),
    sales: item.totalSaleAmount ? parseInt(String(item.totalSaleAmount).replace(/,/g, ''), 10) : null,
    pool: item.poolBalanceAfterdraw ? parseInt(String(item.poolBalanceAfterdraw).replace(/,/g, ''), 10) : null
  };
}

function parseJisuItem(item) {
  const front = String(item.number || '').trim().split(/\s+/).filter(Boolean).map(Number);
  let back = String(item.refernumber || '').trim().split(/\s+/).filter(Boolean).map(Number);
  if (back.length === 0 && front.length >= 7) {
    back = front.slice(5, 7);
  }
  return {
    issue: item.issueno,
    date: item.opendate || '',
    front: front.slice(0, 5),
    back: back.slice(0, 2),
    sales: item.saleamount ? parseInt(String(item.saleamount).replace(/,/g, ''), 10) : null,
    pool: item.totalmoney ? parseInt(String(item.totalmoney).replace(/,/g, ''), 10) : null
  };
}

runDualSourceScrape({
  lotteryName: '超级大乐透',
  outputFile: OUTPUT_FILE,
  primarySource: createJisuSource({
    name: 'JisuAPI 主源',
    jisuCaipiaoId: 14,
    parseJisuItem,
    expectedFrontCount: 5,
    expectedBackCount: 2
  }),
  secondarySource: createOfficialSource({
    name: '体彩官方副源',
    officialGameNo: '85',
    officialPageSize: 100,
    parseOfficialItem,
    expectedFrontCount: 5,
    expectedBackCount: 2
  })
});
