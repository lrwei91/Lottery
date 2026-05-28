const https = require('https');
const fs = require('fs');
const path = require('path');

const JISU_API_BASE = 'https://api.jisuapi.com/caipiao';
const OFFICIAL_API_BASE = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      timeout: options.timeout || 10000,
      headers: options.headers || {}
    };

    const req = https.get(url, requestOptions, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`JSON 解析错误: ${error.message}\n返回数据: ${data.substring(0, 300)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时 (${requestOptions.timeout}ms)`));
    });
  });
}

async function withRetry(task, label, retries = 3, backoff = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`${label} 在 ${retries} 次重试后失败: ${error.message}`);
      }
      const nextDelay = backoff * Math.pow(2, attempt - 1);
      console.warn(`  ⚠️ ${label} 失败 (第 ${attempt} 次尝试)，${nextDelay}ms 后重试... 原因: ${error.message}`);
      await sleep(nextDelay);
    }
  }
}

function loadLocalRecords(outputFile) {
  let localRecords = [];
  let latestLocalIssue = 0;

  if (!fs.existsSync(outputFile)) {
    return { localRecords, latestLocalIssue };
  }

  try {
    const localContent = fs.readFileSync(outputFile, 'utf8');
    const localJson = JSON.parse(localContent);
    localRecords = localJson.data || [];
    latestLocalIssue = localRecords.length > 0 ? parseInt(localRecords[0].issue, 10) || 0 : 0;
  } catch (error) {
    console.warn(`⚠️ 本地数据文件读取失败或非有效 JSON 格式，将默认执行全量数据重构: ${error.message}`);
  }

  return { localRecords, latestLocalIssue };
}

function saveRecords(outputFile, records, sourceName) {
  const dataDir = path.dirname(outputFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const output = {
    updateTime: new Date().toISOString(),
    total: records.length,
    source: sourceName,
    data: records
  };

  fs.writeFileSync(outputFile, JSON.stringify(output), 'utf8');
}

function validateRecord(record, expectedFrontCount, expectedBackCount) {
  if (!record || !record.issue) {
    throw new Error('记录缺少期号');
  }
  if (!Array.isArray(record.front) || record.front.length !== expectedFrontCount) {
    throw new Error(`第 ${record.issue} 期前区数量异常: ${JSON.stringify(record.front)}`);
  }
  if (expectedBackCount > 0 && (!Array.isArray(record.back) || record.back.length !== expectedBackCount)) {
    throw new Error(`第 ${record.issue} 期后区数量异常: ${JSON.stringify(record.back)}`);
  }
  if ([...record.front, ...(record.back || [])].some(num => !Number.isFinite(num))) {
    throw new Error(`第 ${record.issue} 期号码包含非数字: ${JSON.stringify(record)}`);
  }
  return record;
}

function mergeRecords(newRecords, localRecords) {
  const uniqueMap = new Map();
  // localRecords first, then newRecords override (new data wins)
  [...localRecords, ...newRecords].forEach(item => {
    uniqueMap.set(item.issue, item);
  });
  return [...uniqueMap.values()].sort((a, b) => parseInt(b.issue, 10) - parseInt(a.issue, 10));
}

function createOfficialSource(config) {
  const { name, officialGameNo, officialPageSize, parseOfficialItem, expectedFrontCount, expectedBackCount } = config;

  return {
    name,
    async fetchNewRecords(latestLocalIssue, forceRefresh = false) {
      async function fetchPage(pageNo) {
        const url = `${OFFICIAL_API_BASE}?gameNo=${officialGameNo}&provinceId=0&pageSize=${officialPageSize}&isVerify=1&pageNo=${pageNo}`;
        const json = await requestJson(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.lottery.gov.cn/'
          }
        });

        if (!json || json.errorCode !== '0' || !json.value || !Array.isArray(json.value.list)) {
          throw new Error(`官方 API 返回异常: ${JSON.stringify(json).substring(0, 500)}`);
        }
        return json;
      }

      console.log('📡 主源不可用，切换到体彩官方副源...');
      console.log('📄 正在连接体彩官方 API 检索最新数据...');

      const firstPage = await withRetry(() => fetchPage(1), '获取官方第 1 页');
      const list = firstPage.value.list || [];
      if (list.length === 0) {
        throw new Error('官方 API 未返回任何有效的开奖记录列表');
      }

      const latestIssue = parseInt(list[0].lotteryDrawNum, 10) || 0;
      const totalCount = firstPage.value.total || 0;
      const totalPages = Math.ceil(totalCount / officialPageSize);
      console.log(`📊 官方副源状态: 共有 ${totalCount} 期记录，最新一期为第 ${latestIssue} 期。`);

      if (latestLocalIssue > 0 && latestIssue === latestLocalIssue && !forceRefresh) {
        return { latestIssue, records: [] };
      }

      const records = [];
      let isGapClosed = false;

      for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
        const pageData = pageNo === 1
          ? firstPage
          : await withRetry(() => fetchPage(pageNo), `获取官方第 ${pageNo} 页`);

        if (pageNo > 1) {
          await sleep(300);
          console.log(`📄 正在获取官方第 ${pageNo}/${totalPages} 页...`);
        }

        let pageNewCount = 0;
        for (const item of pageData.value.list) {
          const parsed = validateRecord(parseOfficialItem(item), expectedFrontCount, expectedBackCount);
          const issueNum = parseInt(parsed.issue, 10);
          if (issueNum > latestLocalIssue) {
            records.push(parsed);
            pageNewCount++;
          } else if (forceRefresh && issueNum >= latestLocalIssue - 5 && issueNum <= latestLocalIssue) {
            // forceRefresh: 返回最近 5 条以补全缺失的 sales/pool
            records.push(parsed);
            pageNewCount++;
          } else {
            isGapClosed = true;
          }
        }

        console.log(`  ✅ 官方第 ${pageNo} 页分析完成: 追补了 ${pageNewCount} 期新纪录`);
        if (isGapClosed) {
          console.log(`🎯 官方副源已衔接到本地最新期 ${latestLocalIssue}，停止继续翻页。`);
          break;
        }
      }

      return { latestIssue, records };
    }
  };
}

function createJisuSource(config) {
  const { name, jisuCaipiaoId, parseJisuItem, expectedFrontCount, expectedBackCount } = config;
  const appKey = process.env.JISU_API_KEY || process.env.JISU_APPKEY || '';
  const pageSize = 20;

  return {
    name,
    enabled: Boolean(appKey),
    async fetchNewRecords(latestLocalIssue, forceRefresh = false) {
      if (!appKey) {
        throw new Error('未配置 JISU_API_KEY/JISU_APPKEY');
      }

      async function fetchHistory(start) {
        const url = `${JISU_API_BASE}/history?appkey=${encodeURIComponent(appKey)}&caipiaoid=${jisuCaipiaoId}&start=${start}&num=${pageSize}`;
        const json = await requestJson(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Codex/Ticai',
            'Accept': 'application/json'
          }
        });

        if (!json || json.status !== 0 || !json.result || !Array.isArray(json.result.list)) {
          const message = json && json.msg ? json.msg : JSON.stringify(json).substring(0, 300);
          throw new Error(`JisuAPI 返回异常: ${message}`);
        }
        return json;
      }

      console.log('🚀 正在连接 JisuAPI 主源检索最新数据...');
      const firstBatch = await withRetry(() => fetchHistory(0), '获取 Jisu 主源第 1 批');
      const list = firstBatch.result.list || [];
      if (list.length === 0) {
        throw new Error('JisuAPI 未返回任何有效的开奖记录列表');
      }

      const latestIssue = parseInt(list[0].issueno, 10) || 0;
      console.log(`📊 Jisu 主源状态: 最新一期为第 ${latestIssue} 期。`);

      if (latestLocalIssue > 0 && latestIssue === latestLocalIssue && !forceRefresh) {
        return { latestIssue, records: [] };
      }

      const records = [];
      let start = 0;
      let batchIndex = 0;
      let isGapClosed = false;

      while (true) {
        const batch = batchIndex === 0
          ? firstBatch
          : await withRetry(() => fetchHistory(start), `获取 Jisu 主源第 ${batchIndex + 1} 批`);
        const batchList = batch.result.list || [];

        if (batchIndex > 0) {
          await sleep(200);
        }

        if (batchList.length === 0) {
          break;
        }

        let batchNewCount = 0;
        for (const item of batchList) {
          const parsed = validateRecord(parseJisuItem(item), expectedFrontCount, expectedBackCount);
          const issueNum = parseInt(parsed.issue, 10);
          if (issueNum > latestLocalIssue) {
            records.push(parsed);
            batchNewCount++;
          } else if (forceRefresh && issueNum >= latestLocalIssue - 5 && issueNum <= latestLocalIssue) {
            // forceRefresh: 返回最近 5 条以补全缺失的 sales/pool
            records.push(parsed);
            batchNewCount++;
          } else {
            isGapClosed = true;
          }
        }

        console.log(`  ✅ Jisu 第 ${batchIndex + 1} 批分析完成: 追补了 ${batchNewCount} 期新纪录`);

        if (isGapClosed || batchList.length < pageSize) {
          break;
        }

        batchIndex++;
        start += pageSize;
      }

      return { latestIssue, records };
    }
  };
}

function recordNeedsRefresh(record) {
  // 如果最新一期缺少 sales 数据，需要强制刷新
  // 注意：不检查 pool，因为排列三等彩种本身没有奖池滚存（pool=0 是正常的）
  if (!record) return false;
  return (record.sales === null || record.sales === 0);
}

async function runDualSourceScrape(config) {
  const { lotteryName, outputFile, primarySource, secondarySource } = config;

  console.log(`🎰 开始执行体彩${lotteryName}历史开奖数据自动同步机制...\n`);

  const { localRecords, latestLocalIssue } = loadLocalRecords(outputFile);
  if (localRecords.length > 0) {
    console.log(`ℹ️ 本地数据库检测成功: 共保存有 ${localRecords.length} 期数据，最新一期为第 ${latestLocalIssue} 期。`);
  } else {
    console.log('ℹ️ 未检测到本地历史数据库文件，将执行首次全量数据重构。');
  }

  // 检查最新 3 条记录是否需要刷新（sales/pool 缺失）
  const refreshWindow = Math.min(3, localRecords.length);
  let needsRefresh = false;
  let refreshIssues = [];
  for (let i = 0; i < refreshWindow; i++) {
    if (recordNeedsRefresh(localRecords[i])) {
      needsRefresh = true;
      refreshIssues.push(localRecords[i].issue);
    }
  }
  if (needsRefresh) {
    console.log(`⚠️ 检测到最近记录缺少销售额/奖池数据 [${refreshIssues.join(', ')}]，将强制刷新...`);
  }

  const sources = [primarySource, secondarySource].filter(Boolean);
  let finalError = null;

  for (const source of sources) {
    if (source.enabled === false) {
      console.log(`⏭️ 跳过 ${source.name}: 当前未配置接入所需凭证。`);
      continue;
    }

    try {
      const { latestIssue, records } = await source.fetchNewRecords(latestLocalIssue, needsRefresh);

      if (latestLocalIssue > 0 && latestIssue === latestLocalIssue && records.length === 0 && !needsRefresh) {
        console.log(`\n🎉 【数据状态: 最新】本地第 ${latestLocalIssue} 期已与 ${source.name} 同步，无需更新。`);
        return;
      }

      if (records.length === 0 && !needsRefresh) {
        console.log('\nℹ️ 未发现任何需要更新的号码差值。');
        return;
      }

      const finalSortedRecords = mergeRecords(records, localRecords);
      if (process.env.DRY_RUN === '1') {
        console.log(`\n🧪 DRY_RUN=1：已验证可追补 ${records.length} 期，未写入 ${outputFile}。`);
        return;
      }
      saveRecords(outputFile, finalSortedRecords, source.name);

      console.log(`\n🎉 数据追补成功！本次共自动同步了 ${records.length} 期新数据。`);
      console.log(`💾 本地全量开奖数据库已更新至 ${finalSortedRecords.length} 期，当前采用数据源: ${source.name}`);
      return;
    } catch (error) {
      finalError = error;
      console.warn(`\n⚠️ ${source.name} 同步失败: ${error.message}`);
    }
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    console.warn('\n⚠️ GitHub Actions 运行时两路数据源均未成功返回数据，本次自动更新已静默通过。');
    process.exit(0);
  }

  console.error(`\n❌ 数据同步异常失败: ${finalError ? finalError.message : '未知错误'}`);
  process.exit(1);
}

module.exports = {
  createJisuSource,
  createOfficialSource,
  runDualSourceScrape,
  validateRecord
};
