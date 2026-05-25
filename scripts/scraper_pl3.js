/**
 * 体彩排列三历史开奖数据抓取脚本
 * 主源：JisuAPI
 * 副源：sporttery.cn 官方 API
 */

const path = require('path');
const {
  createJisuSource,
  createOfficialSource,
  runDualSourceScrape
} = require('./lottery_scraper_common');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'pl3_data.json');

function parseOfficialItem(item) {
  const numbers = item.lotteryDrawResult.trim().split(/\s+/).map(Number);
  return {
    issue: item.lotteryDrawNum,
    date: item.lotteryDrawTime ? item.lotteryDrawTime.split(' ')[0] : '',
    front: numbers.slice(0, 3),
    back: [],
    sales: item.totalSaleAmount ? parseInt(String(item.totalSaleAmount).replace(/,/g, ''), 10) : null,
    pool: item.poolBalanceAfterdraw ? parseInt(String(item.poolBalanceAfterdraw).replace(/,/g, ''), 10) : null
  };
}

function parseJisuItem(item) {
  const front = String(item.number || '').trim().split(/\s+/).filter(Boolean).map(Number);
  return {
    issue: item.issueno,
    date: item.opendate || '',
    front: front.slice(0, 3),
    back: [],
    sales: item.saleamount ? parseInt(String(item.saleamount).replace(/,/g, ''), 10) : null,
    pool: item.totalmoney ? parseInt(String(item.totalmoney).replace(/,/g, ''), 10) : null
  };
}

runDualSourceScrape({
  lotteryName: '排列三',
  outputFile: OUTPUT_FILE,
  primarySource: createJisuSource({
    name: 'JisuAPI 主源',
    jisuCaipiaoId: 16,
    parseJisuItem
  }),
  secondarySource: createOfficialSource({
    name: '体彩官方副源',
    officialGameNo: '35',
    officialPageSize: 100,
    parseOfficialItem
  })
});
