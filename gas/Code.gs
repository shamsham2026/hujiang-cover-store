/**
 * 滬江小學調課／代課腳本（優化版）
 * 與試算表「自動更新GAS代碼」同一套流程，修正：
 * 1. swapLessonsBatch 參照未宣告的 dutyLoc，放學對調會直接失敗。
 * 2. syncDutyToDatabase 從第 1193 列寫入，會覆蓋 4A 等正課。改為只替換當值／班主任節列。
 * 3. 每小時刷新會清空最新課表上萬列。公式已在時不再重寫。
 * 4. 安裝每小時觸發器會一併刪掉下午 4 時觸發器。
 * 5. 調課暫存逐格 setValue。改為一次 setValues，並加上腳本鎖。
 * 6. 標題沒變也會 rename。
 * 網頁介面在 Index.html。部署：網頁應用程式、執行身分「我」、存取權「任何人」。
 */

/**
 * 課表定時自動更新與調課/代課管理腳本 (動態 14 天排課 + 跨天調課 + 放學當值對調 + 代課下載 + 代課表格 Web App 直寫 + 一鍵安全清空升級版)
 * 支援：
 * 1. 桌面試算表：
 *    - 【全新升級】動態 14 天最新課表自動展現（排除週末，涵蓋兩週上課日，全校 1800+ 筆排課與當值無截斷完整覆蓋）
 *    - 支援同日調課與跨天調課（讀取「調課安排!C6」受調日期與排課資料庫跨日反查）
 *    - 支援「放學當值」及各時段當值崗位之雙向對調寫入（讀取列25放學與當值崗位，自動雙向對調）
 *    - 支援「代課」模式（讀取「可以代課」狀態單向寫入暫存與課表，並彈出調課/代課紙 PDF 下載彈窗）
 *    - 支援「一鍵清空調課與代課表格」(clearAllSubAndSwapSheets)，保留所有公式、格式樣式與表頭標籤
 * 2. Web App 行動端直寫支援：
 *    - 支援「代課表格」直接寫入（writeSubstituteTable / Web App 表單直寫），動態公式自動連動課表與當值
 *    - 支援即時課堂與當值調動（swapLessonsBatch），跨天批次調課一鍵生效
 *    - 支援 doGet / doPost API 與視覺化雙模式響應式 Web 介面
 * 3. 定時排程更新：
 *    - 支援每小時定時刷新最新課表
 *    - 支援每天下午 4 時 (16:00) 定時自動更新課表 (installDaily4PMTrigger)
 *    - 當值同步 (duty -> 排課資料庫)、自動檔名更新、防誤判節次修復
 */

// 1. 開啟試算表時自動建立自訂選單
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📅 課表自動化管理')
    .addItem('✅ 確認調課/代課並下載課堂表格 (支援跨天與當值)', 'confirmLessonSwapAndDownload')
    .addItem('📋 代課表格管理與直寫說明', 'showWriteSubstituteDialog')
    .addItem('🌐 取得 WebApp 即時調課/代課網址與使用說明', 'showWebAppInfo')
    .addItem('🔄 檢查最新課表公式（公式已在則不重寫）', 'refreshLatestTimetable')
    .addItem('🛠️ 強制重寫最新課表公式', 'refreshLatestTimetableForce')
    .addItem('📋 同步當值安排至排課資料庫 (syncDutyToDatabase)', 'syncDutyToDatabase')
    .addItem('🏷️ 更新試算表標題（下載檔名）', 'updateDocumentTitle')
    .addSeparator()
    .addItem('🧹 一鍵清空調課與代課表格 (保留公式與表頭)', 'clearAllSubAndSwapSheets')
    .addSeparator()
    .addItem('⏰ 安裝每小時定時更新觸發器', 'installHourlyTrigger')
    .addItem('⏰ 安裝每天下午4時定時更新', 'installDaily4PMTrigger')
    .addItem('🛑 移除定時自動更新觸發器', 'removeTriggers')
    .addToUi();
}

/**
 * 日期格式化與解析輔助函式
 */
function normalizeDateStr(str) {
  if (!str) return "";
  if (str instanceof Date) {
    return Utilities.formatDate(str, 'GMT+8', 'yyyy-MM-dd');
  }
  let parts = str.toString().trim().split(/[-\\\/]/);
  if (parts.length === 3) {
    let y, m, d;
    if (parts[0].length === 4) { // yyyy-m-d
      y = parts[0]; m = parts[1]; d = parts[2];
    } else { // d-m-yyyy
      d = parts[0]; m = parts[1]; y = parts[2];
    }
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return str.toString().trim();
}

function parseDateRobust(dStr) {
  if (!dStr) return new Date();
  if (dStr instanceof Date) return dStr;
  const norm = normalizeDateStr(dStr);
  const parts = String(norm).trim().split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dObj = new Date(y, m, d);
    if (!isNaN(dObj.getTime())) return dObj;
  }
  let dObj = new Date(dStr);
  return isNaN(dObj.getTime()) ? new Date() : dObj;
}

function formatDateString(dObj) {
  return Utilities.formatDate(dObj, 'GMT+8', 'yyyy-MM-dd');
}

function getDayOfWeek(dObj) {
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  return weekDays[dObj.getDay()] || '一';
}

/**
 * 2. 確認調課/代課並下載表格
 */
function confirmLessonSwapAndDownload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const arrangeSheet = ss.getSheetByName('調課安排');
  const tempSheet = ss.getSheetByName('調課暫存');
  const paperSheet = ss.getSheetByName('調課紙');
  
  if (!arrangeSheet || !tempSheet) {
    SpreadsheetApp.getUi().alert('❌ 找不到「調課安排」或「調課暫存」工作表！');
    return;
  }
  
  const origDateRaw = arrangeSheet.getRange('C3').getDisplayValue().trim();
  const targetDateInput = arrangeSheet.getRange('C6').getDisplayValue().trim();
  const origDateStr = normalizeDateStr(origDateRaw);
  const targetDateStr = targetDateInput ? normalizeDateStr(targetDateInput) : origDateStr;
  
  const applicantTeacher = arrangeSheet.getRange('C4').getDisplayValue().trim();
  const reason = arrangeSheet.getRange('C5').getDisplayValue().trim();
  
  const origDateObj = parseDateRobust(origDateStr);
  const origDow = getDayOfWeek(origDateObj);
  
  const targetDateObj = parseDateRobust(targetDateStr);
  const targetDow = getDayOfWeek(targetDateObj);
  
  const isCrossDay = (origDateStr !== targetDateStr);
  
  const arrangeData = arrangeSheet.getRange('B9:G25').getDisplayValues();
  const swapEntries = [];
  const usedPartnerPeriods = new Set();
  
  for (let i = 0; i < arrangeData.length; i++) {
    const period = arrangeData[i][0].trim();
    const origLesson = arrangeData[i][1].trim();
    const origPeriod = arrangeData[i][2].trim();
    const targetLesson = arrangeData[i][3].trim();
    const partnerTeacher = arrangeData[i][4].trim();
    const status = arrangeData[i][5].trim();
    
    // 模式 A：支援「可以代課」單向寫入
    if (status === '可以代課') {
      const subTeacher = partnerTeacher || origPeriod;
      if (subTeacher && subTeacher !== '不用代課') {
        const classMatch = (targetLesson || origLesson).match(/^([1-6][A-D])/);
        const className = classMatch ? classMatch[1] : (origLesson || targetLesson);
        if (className) {
          const key = origDateStr + '_' + className + '_' + period;
          swapEntries.push({
            date: origDateStr,
            dow: origDow,
            period: period,
            className: className,
            origTeacher: applicantTeacher,
            newTeacher: subTeacher,
            newLesson: targetLesson || origLesson,
            swapType: '課堂代課',
            key: key
          });
        }
      }
    }
    // 模式 B：支援「可以調動」或「可以對調」雙向對調寫入
    else if (origPeriod && origPeriod !== '不用調課' && (status === '可以調動' || status === '可以對調')) {
      const isDuty = (period === '放學' || period.includes('當值') || targetLesson.includes('放學') || origPeriod.includes('放學') || !targetLesson.match(/^[1-6][A-D]/));
      
      if (isDuty) {
        let dutyLoc = origLesson || targetLesson;
        if (targetLesson.includes(':')) {
          dutyLoc = targetLesson.split(':')[1].trim();
        } else if (origLesson) {
          dutyLoc = origLesson.trim();
        }
        
        let pPeriod = period;
        if (targetLesson.includes(':')) {
          const m = targetLesson.split(':')[0].match(/(早會前|班主任節|第一小息|第二小息|小息1|小息2|午膳|午息|放學當值|放學|\d+)/);
          if (m) pPeriod = m[1];
        }
        
        const key1 = origDateStr + '_' + dutyLoc + '_' + period;
        swapEntries.push({
          date: origDateStr,
          dow: origDow,
          period: period,
          className: dutyLoc,
          origTeacher: applicantTeacher,
          newTeacher: partnerTeacher,
          newLesson: targetLesson,
          swapType: isCrossDay ? '跨天調動' : '課堂調動',
          key: key1
        });
        
        const partnerOrigLesson = isCrossDay ? (origDow + period + ':' + dutyLoc) : (period + ':' + dutyLoc);
        const key2 = targetDateStr + '_' + dutyLoc + '_' + pPeriod;
        swapEntries.push({
          date: targetDateStr,
          dow: targetDow,
          period: pPeriod,
          className: dutyLoc,
          origTeacher: partnerTeacher,
          newTeacher: applicantTeacher,
          newLesson: partnerOrigLesson,
          swapType: isCrossDay ? '跨天調動' : '課堂調動',
          key: key2
        });
      } else {
        const classMatch = targetLesson.match(/^([1-6][A-D])/);
        const className = classMatch ? classMatch[1] : (origLesson.match(/^([1-6][A-D])/) ? origLesson.match(/^([1-6][A-D])/)[1] : '');
        
        if (className) {
          const key1 = origDateStr + '_' + className + '_' + period;
          swapEntries.push({
            date: origDateStr,
            dow: origDow,
            period: period,
            className: className,
            origTeacher: applicantTeacher,
            newTeacher: partnerTeacher,
            newLesson: targetLesson,
            swapType: isCrossDay ? '跨天調動' : '課堂調動',
            key: key1
          });
          
          let partnerOrigPeriod = '';
          const cleanOrigPeriod = origPeriod.replace(/[1-6][A-D]/g, '').trim();
          const matchOrig = cleanOrigPeriod.match(/第\s*(\d+)\s*節/) || cleanOrigPeriod.match(/^(\d+)$/);
          if (matchOrig) {
            partnerOrigPeriod = matchOrig[1];
          } else {
            const dbSheet = ss.getSheetByName('排課資料庫');
            if (dbSheet) {
              const dbData = dbSheet.getRange('A2:E' + dbSheet.getLastRow()).getValues();
              for (let d = 0; d < dbData.length; d++) {
                const candP = String(dbData[d][2]).trim();
                if (dbData[d][0] == className && dbData[d][1] == targetDow && dbData[d][3] == targetLesson && dbData[d][4] == partnerTeacher && !usedPartnerPeriods.has(candP)) {
                  partnerOrigPeriod = candP;
                  usedPartnerPeriods.add(candP);
                  break;
                }
              }
            }
          }
          
          if (partnerOrigPeriod) {
            const key2 = targetDateStr + '_' + className + '_' + partnerOrigPeriod;
            swapEntries.push({
              date: targetDateStr,
              dow: targetDow,
              period: partnerOrigPeriod,
              className: className,
              origTeacher: partnerTeacher,
              newTeacher: applicantTeacher,
              newLesson: origLesson,
              swapType: isCrossDay ? '跨天調動' : '課堂調動',
              key: key2
            });
          }
        }
      }
    }
  }
  
  if (swapEntries.length === 0) {
    SpreadsheetApp.getUi().alert('⚠️ 未偵測到符合調動或代課條件之課堂！請確認教節與狀態（可以調動/可以對調/可以代課）。');
    return;
  }
  
  saveSwapEntriesToTemp(swapEntries);
  refreshLatestTimetable();
  updateDocumentTitle();
  
  const paperSheetId = paperSheet ? paperSheet.getSheetId() : '';
  const exportUrl = ss.getUrl().replace(/edit$/, '') + 'export?format=pdf&gid=' + paperSheetId +
                    '&size=7&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&fzr=false';
  
  const hasSub = swapEntries.some(e => e.swapType === '課堂代課');
  const hasSwap = swapEntries.some(e => e.swapType !== '課堂代課');
  let typeTitle = '調課/代課';
  if (hasSub && !hasSwap) typeTitle = '代課';
  else if (!hasSub && hasSwap) typeTitle = '調課';

  const crossDayNote = isCrossDay ? `<p style="color:#d93025; font-weight:bold;">⚡ 此次為跨天調課：原課堂 (${origDateStr}) ⇄ 受調課堂 (${targetDateStr})</p>` : '';
  
  const htmlOutput = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif; text-align:center; padding:20px;">' +
    `<h3 style="color:#0f9d58;">✅ ${typeTitle}安排已確認並成功寫入課表！</h3>` +
    crossDayNote +
    `<p>已成功寫入 ${swapEntries.length} 筆${typeTitle}紀錄，課表與暫存庫均已同步更新。</p>` +
    '<p><a href="' + exportUrl + '" target="_blank" style="display:inline-block; padding:10px 20px; background-color:#1a73e8; color:white; text-decoration:none; border-radius:4px; font-weight:bold;">📥 點此下載' + typeTitle + '紙 PDF</a></p>' +
    '</div>'
  ).setWidth(440).setHeight(250);
  
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, typeTitle + '確認完成');
}

/**
 * 寫入或更新「調課暫存」共用函式
 */
function saveSwapEntriesToTemp(swapEntries) {
  if (!swapEntries || !swapEntries.length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tempSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('調課暫存');
    if (!tempSheet) return;
    const lastRow = Math.max(tempSheet.getLastRow(), 1);
    const existing = lastRow > 1 ? tempSheet.getRange(2, 1, lastRow - 1, 9).getValues() : [];
    const keyToIndex = {};
    for (let i = 0; i < existing.length; i++) {
      const key = String(existing[i][8] || '');
      if (key) keyToIndex[key] = i;
    }
    const appended = [];
    swapEntries.forEach(function(entry) {
      const row = [entry.date, entry.dow, entry.period, entry.className, entry.origTeacher, entry.newTeacher, entry.newLesson, entry.swapType, entry.key];
      if (Object.prototype.hasOwnProperty.call(keyToIndex, entry.key)) {
        existing[keyToIndex[entry.key]] = row;
      } else {
        keyToIndex[entry.key] = existing.length + appended.length;
        appended.push(row);
      }
    });
    if (existing.length) tempSheet.getRange(2, 1, existing.length, 9).setValues(existing);
    if (appended.length) tempSheet.getRange(existing.length + 2, 1, appended.length, 9).setValues(appended);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 3. 強制刷新「最新課表」工作表 (升級版：動態 14 天排程 + 自動清空殘留防溢位 + A2 與 H2 雙格公式同步刷新)
 */
function refreshLatestTimetable() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('最新課表');
  if (!sheet) {
    SpreadsheetApp.getActiveSpreadsheet().toast('找不到「最新課表」工作表！', '錯誤', 5);
    return;
  }
  const cellA2 = sheet.getRange('A2');
  const cellH2 = sheet.getRange('H2');
  const formulaA = cellA2.getFormula();
  const formulaH = cellH2.getFormula();
  if (formulaA && formulaH) {
    cellA2.setFormula(formulaA);
    cellH2.setFormula(formulaH);
    SpreadsheetApp.flush();
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('最新課表已重新計算，未清空整表。', '更新成功', 4);
    } catch (err) {}
    return;
  }
  const defaultFormulaA2 = '=LET(base_d, IFERROR(DATEVALUE(TEXT(\'調課安排\'!$C$3, "yyyy-mm-dd")), \'調課安排\'!$C$3), start_d, IF(ISNUMBER(base_d)*(base_d>=DATE(2026,9,1)), base_d, IF(HOUR(NOW())>=16, TODAY()+1, TODAY())), adj_start, IFS(WEEKDAY(start_d, 2)=6, start_d+2, WEEKDAY(start_d, 2)=7, start_d+1, TRUE, start_d), all_days, FILTER(adj_start + SEQUENCE(14, 1, 0, 1), WEEKDAY(adj_start + SEQUENCE(14, 1, 0, 1), 2) <= 5), all_dates_str, MAP(all_days, LAMBDA(dt, TEXT(dt, "yyyy-mm-dd"))), all_dows, MAP(all_days, LAMBDA(dt, CHOOSE(WEEKDAY(dt, 2), "一", "二", "三", "四", "五"))), day_data, LAMBDA(d, dow, LET(db, FILTER(\'排課資料庫\'!$A$2:$E, (\'排課資料庫\'!$B$2:$B=dow)*(\'排課資料庫\'!$A$2:$A<>"")), n, ROWS(db), cls, INDEX(db,, 1), p, INDEX(db,, 3), sub, INDEX(db,, 4), tch, INDEX(db,, 5), keys, MAP(cls, p, LAMBDA(c_val, p_val, d & "_" & c_val & "_" & p_val)), new_sub, MAP(keys, sub, LAMBDA(k, s, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$G$2:$G, s, 0, -1), s))), new_tch, MAP(keys, tch, LAMBDA(k, t, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$F$2:$F, t, 0, -1), t))), status, MAP(keys, LAMBDA(k, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$H$2:$H, "", 0, -1), ""))), UNIQUE(HSTACK(MAKEARRAY(n, 1, LAMBDA(r, c, d)), MAKEARRAY(n, 1, LAMBDA(r, c, dow)), cls, p, new_sub, new_tch, status)))), REDUCE(day_data(INDEX(all_dates_str, 1), INDEX(all_dows, 1)), SEQUENCE(ROWS(all_days)-1, 1, 2, 1), LAMBDA(acc, i, VSTACK(acc, day_data(INDEX(all_dates_str, i), INDEX(all_dows, i))))))';
  const defaultFormulaH2 = '=IFERROR(LET(dates, FILTER(A2:A, A2:A<>""), classes, FILTER(C2:C, A2:A<>""), periods, FILTER(D2:D, A2:A<>""), ext_raw, FILTER(\'校外導師不可調動\'!$A$4:$G, \'校外導師不可調動\'!$A$4:$A<>""), ext_prog, CHOOSECOLS(ext_raw, 1), ext_cls, CHOOSECOLS(ext_raw, 2), ext_slot, MAP(CHOOSECOLS(ext_raw, 6), LAMBDA(s, IF(ISNUMBER(s), TEXT(s, "m-d"), TRIM(s&"")))), ext_date, MAP(CHOOSECOLS(ext_raw, 7), LAMBDA(d, TRIM(d&""))), months, {"Jan"; "Feb"; "Mar"; "Apr"; "May"; "Jun"; "Jul"; "Aug"; "Sep"; "Oct"; "Nov"; "Dec"}, MAP(dates, classes, periods, LAMBDA(d_val, c_val, p_val, LET(dt, IFERROR(DATEVALUE(d_val), d_val), fmt_d, DAY(dt) & " " & INDEX(months, MONTH(dt)), p_slot, IFS(OR(p_val=1, p_val="1", p_val=2, p_val="2"), "1-2", OR(p_val=3, p_val="3", p_val=4, p_val="4"), "3-4", OR(p_val=5, p_val="5", p_val=6, p_val="6"), "5-6", OR(p_val=7, p_val="7", p_val=8, p_val="8"), "7-8", OR(p_val=9, p_val="9", p_val=10, p_val="10"), "9-10", TRUE, ""), IF(p_slot="", "", LET(match_res, FILTER(ext_prog, (ext_date=fmt_d) * (IFERROR(REGEXMATCH(ext_slot, c_val & ":[ ]*" & p_slot), FALSE) + (ISNUMBER(SEARCH(c_val, ext_cls)) * ((ext_slot = p_slot) + (ext_slot = p_val) + (ext_slot = TEXT(p_val, "@")))) > 0)), IFERROR(INDEX(match_res, 1), ""))))))), "")';
  if (!cellA2.getFormula()) cellA2.setFormula(defaultFormulaA2);
  if (!cellH2.getFormula()) cellH2.setFormula(defaultFormulaH2);
  SpreadsheetApp.flush();
}

function refreshLatestTimetableForce() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('最新課表');
  if (!sheet) return;
  const defaultFormulaA2 = '=LET(base_d, IFERROR(DATEVALUE(TEXT(\'調課安排\'!$C$3, "yyyy-mm-dd")), \'調課安排\'!$C$3), start_d, IF(ISNUMBER(base_d)*(base_d>=DATE(2026,9,1)), base_d, IF(HOUR(NOW())>=16, TODAY()+1, TODAY())), adj_start, IFS(WEEKDAY(start_d, 2)=6, start_d+2, WEEKDAY(start_d, 2)=7, start_d+1, TRUE, start_d), all_days, FILTER(adj_start + SEQUENCE(14, 1, 0, 1), WEEKDAY(adj_start + SEQUENCE(14, 1, 0, 1), 2) <= 5), all_dates_str, MAP(all_days, LAMBDA(dt, TEXT(dt, "yyyy-mm-dd"))), all_dows, MAP(all_days, LAMBDA(dt, CHOOSE(WEEKDAY(dt, 2), "一", "二", "三", "四", "五"))), day_data, LAMBDA(d, dow, LET(db, FILTER(\'排課資料庫\'!$A$2:$E, (\'排課資料庫\'!$B$2:$B=dow)*(\'排課資料庫\'!$A$2:$A<>"")), n, ROWS(db), cls, INDEX(db,, 1), p, INDEX(db,, 3), sub, INDEX(db,, 4), tch, INDEX(db,, 5), keys, MAP(cls, p, LAMBDA(c_val, p_val, d & "_" & c_val & "_" & p_val)), new_sub, MAP(keys, sub, LAMBDA(k, s, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$G$2:$G, s, 0, -1), s))), new_tch, MAP(keys, tch, LAMBDA(k, t, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$F$2:$F, t, 0, -1), t))), status, MAP(keys, LAMBDA(k, IFERROR(XLOOKUP(k, \'調課暫存\'!$I$2:$I, \'調課暫存\'!$H$2:$H, "", 0, -1), ""))), UNIQUE(HSTACK(MAKEARRAY(n, 1, LAMBDA(r, c, d)), MAKEARRAY(n, 1, LAMBDA(r, c, dow)), cls, p, new_sub, new_tch, status)))), REDUCE(day_data(INDEX(all_dates_str, 1), INDEX(all_dows, 1)), SEQUENCE(ROWS(all_days)-1, 1, 2, 1), LAMBDA(acc, i, VSTACK(acc, day_data(INDEX(all_dates_str, i), INDEX(all_dows, i))))))';
  const defaultFormulaH2 = '=IFERROR(LET(dates, FILTER(A2:A, A2:A<>""), classes, FILTER(C2:C, A2:A<>""), periods, FILTER(D2:D, A2:A<>""), ext_raw, FILTER(\'校外導師不可調動\'!$A$4:$G, \'校外導師不可調動\'!$A$4:$A<>""), ext_prog, CHOOSECOLS(ext_raw, 1), ext_cls, CHOOSECOLS(ext_raw, 2), ext_slot, MAP(CHOOSECOLS(ext_raw, 6), LAMBDA(s, IF(ISNUMBER(s), TEXT(s, "m-d"), TRIM(s&"")))), ext_date, MAP(CHOOSECOLS(ext_raw, 7), LAMBDA(d, TRIM(d&""))), months, {"Jan"; "Feb"; "Mar"; "Apr"; "May"; "Jun"; "Jul"; "Aug"; "Sep"; "Oct"; "Nov"; "Dec"}, MAP(dates, classes, periods, LAMBDA(d_val, c_val, p_val, LET(dt, IFERROR(DATEVALUE(d_val), d_val), fmt_d, DAY(dt) & " " & INDEX(months, MONTH(dt)), p_slot, IFS(OR(p_val=1, p_val="1", p_val=2, p_val="2"), "1-2", OR(p_val=3, p_val="3", p_val=4, p_val="4"), "3-4", OR(p_val=5, p_val="5", p_val=6, p_val="6"), "5-6", OR(p_val=7, p_val="7", p_val=8, p_val="8"), "7-8", OR(p_val=9, p_val="9", p_val=10, p_val="10"), "9-10", TRUE, ""), IF(p_slot="", "", LET(match_res, FILTER(ext_prog, (ext_date=fmt_d) * (IFERROR(REGEXMATCH(ext_slot, c_val & ":[ ]*" & p_slot), FALSE) + (ISNUMBER(SEARCH(c_val, ext_cls)) * ((ext_slot = p_slot) + (ext_slot = p_val) + (ext_slot = TEXT(p_val, "@")))) > 0)), IFERROR(INDEX(match_res, 1), ""))))))), "")';
  const cellA2 = sheet.getRange('A2');
  const cellH2 = sheet.getRange('H2');
  const maxRows = sheet.getMaxRows();
  if (maxRows >= 3) {
    sheet.getRange(3, 1, maxRows - 2, Math.min(8, sheet.getMaxColumns())).clearContent();
  }
  cellA2.clearContent();
  cellH2.clearContent();
  SpreadsheetApp.flush();
  cellA2.setFormula(cellA2.getFormula() || defaultFormulaA2);
  SpreadsheetApp.flush();
  cellH2.setFormula(defaultFormulaH2);
  SpreadsheetApp.flush();
  ss.toast('已強制重寫最新課表公式。', '更新成功', 5);
}

function installHourlyTrigger() {
  removeTriggersByName(['refreshLatestTimetable'], true);
  ScriptApp.newTrigger('refreshLatestTimetable')
    .timeBased()
    .everyHours(1)
    .create();
  SpreadsheetApp.getUi().alert('✅ 成功安裝每小時定時更新觸發器！\n每天下午 4 時的觸發器會保留。公式已存在時，每小時更新不會再清空整張最新課表。');
}

/**
 * 5. 一鍵安裝每天下午 4 時 (16:00) 定時更新觸發器
 */
function installDaily4PMTrigger() {
  removeDailyTriggers();
  ScriptApp.newTrigger('dailyUpdateTimetable')
    .timeBased()
    .atHour(16)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('Asia/Hong_Kong')
    .create();
  if (SpreadsheetApp.getActiveSpreadsheet()) {
    SpreadsheetApp.getUi().alert('✅ 成功安裝每天定時更新觸發器！\n系統將在每天下午 4:00 (16:00) 自動執行「最新課表」刷新與更新作業。');
  }
}

/**
 * 每天下午 4 時自動定時更新排程處理常式
 */
function dailyUpdateTimetable() {
  refreshLatestTimetable();
  SpreadsheetApp.getActiveSpreadsheet().toast('已於每天下午 4 時完成定時更新作業！', '定時更新', 5);
}

/**
 * 清除既有之 dailyUpdateTimetable 觸發器（避免重複排程）
 */
function removeDailyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyUpdateTimetable') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * 6. 移除所有定時觸發器
 */
function removeTriggersByName(names, silent) {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (names.indexOf(triggers[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  if (!silent) {
    SpreadsheetApp.getActiveSpreadsheet().toast('已清理 ' + count + ' 個自動更新觸發器。', '觸發器管理', 3);
  }
  return count;
}

function removeTriggers() {
  removeTriggersByName(['refreshLatestTimetable', 'dailyUpdateTimetable'], false);
}

/**
 * 7. 自動同步試算表標題（下載檔名，支援代課與跨天調課標註）
 */
function updateDocumentTitle() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('調課安排');
  if (!sheet) return;
  
  const origDateRaw = sheet.getRange('C3').getDisplayValue().trim();
  const targetDateRaw = sheet.getRange('C6').getDisplayValue().trim();
  const teacher = sheet.getRange('C4').getDisplayValue().trim();
  const reason = sheet.getRange('C5').getDisplayValue().trim();
  
  const dateFormatted = normalizeDateStr(origDateRaw);
  const targetDateFormatted = targetDateRaw ? normalizeDateStr(targetDateRaw) : '';
  
  let crossDayStr = '';
  if (targetDateFormatted && targetDateFormatted !== dateFormatted) {
    crossDayStr = `(跨${targetDateFormatted})`;
  }
  
  const relatedTeachers = [];
  const arrangeData = sheet.getRange('B9:G25').getDisplayValues();
  for (let i = 0; i < arrangeData.length; i++) {
    const st = arrangeData[i][5].trim();
    const tch = arrangeData[i][4].trim() || arrangeData[i][2].trim();
    if ((st === '可以代課' || st === '可以調動' || st === '可以對調') && tch && tch !== '不用代課' && tch !== '不用調課' && !relatedTeachers.includes(tch)) {
      relatedTeachers.push(tch);
    }
  }
  
  const isSubMode = sheet.getRange('F4').getDisplayValue().trim() === '代課';
  let partnerStr = '';
  if (relatedTeachers.length > 0) {
    partnerStr = isSubMode ? ('-由' + relatedTeachers.join('、') + '代課') : ('-與' + relatedTeachers.join('、') + '對調');
  }
  
  const newTitle = dateFormatted + crossDayStr + '-' + teacher + (reason ? ('-' + reason) : '') + partnerStr;
  if (ss.getName() === newTitle) return;
  ss.rename(newTitle);
  ss.toast('下載檔案名稱（試算表標題）已更新為：' + newTitle, '標題更新', 5);
}

/**
 * 8. 編輯時自動觸發
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() === '調課安排') {
    const row = e.range.getRow();
    const col = e.range.getColumn();
    if ((col === 3 && (row >= 3 && row <= 6)) || (col === 6 && (row === 4 || row === 21 || row === 22))) {
      updateDocumentTitle();
    }
  }
}

/**
 * 9. 當值排程同步至排課資料庫
 */
function syncDutyToDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dutySheet = ss.getSheetByName('duty');
  const dbSheet = ss.getSheetByName('排課資料庫');
  if (!dutySheet || !dbSheet) {
    SpreadsheetApp.getUi().alert('❌ 找不到「duty」或「排課資料庫」工作表！');
    return;
  }

  const dutyData = dutySheet.getRange('A1:AY40').getDisplayValues();
  const teachers = dutyData[0];
  const entries = [];
  for (let r = 1; r < dutyData.length; r++) {
    const rowLabel = String(dutyData[r][0] || '').trim();
    if (!rowLabel) continue;
    const dow = rowLabel.charAt(0);
    const period = rowLabel.substring(1);
    for (let c = 1; c < teachers.length; c++) {
      const teacher = String(teachers[c] || '').trim();
      const val = String(dutyData[r][c] || '').trim();
      if (!teacher || !val) continue;
      const classMatch = val.match(/^([1-6][A-D](?:[A-D])?)/);
      const className = classMatch ? classMatch[1] : '';
      const courseName = period === '班主任節' ? ('班主任節(' + val + ')') : (period + '當值(' + val + ')');
      entries.push([className, dow, period, courseName, teacher]);
    }
  }
  if (!entries.length) {
    SpreadsheetApp.getUi().alert('⚠️ duty 表內未偵測到任何當值資料！');
    return;
  }

  const lastRow = Math.max(dbSheet.getLastRow(), 1);
  const current = lastRow > 1 ? dbSheet.getRange(2, 1, lastRow - 1, 5).getValues() : [];
  const kept = current.filter(function(row) {
    const course = String(row[3] || '');
    return course.indexOf('當值(') === -1 && course.indexOf('班主任節(') !== 0;
  });
  const merged = kept.concat(entries);
  const width = 5;
  if (dbSheet.getMaxRows() < merged.length + 5) {
    dbSheet.insertRowsAfter(dbSheet.getMaxRows(), merged.length + 20);
  }
  if (lastRow > merged.length + 1) {
    dbSheet.getRange(merged.length + 2, 1, lastRow - merged.length - 1, width).clearContent();
  }
  dbSheet.getRange(2, 1, merged.length, width).setValues(merged);
  ss.toast('✅ 已以 duty 表重寫 ' + entries.length + ' 筆當值，並保留 ' + kept.length + ' 筆正課。不再從第 1193 列覆蓋課堂。', '當值同步完成', 6);
}

function writeSubstituteTable(data) {
  if (!data || !data.teacher) {
    return { success: false, message: '請提供請假教師簡稱！' };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const subSheet = ss.getSheetByName('代課表格');
  if (!subSheet) {
    return { success: false, message: '找不到「代課表格」工作表！' };
  }
  
  let slot = parseInt(data.slot, 10);
  if (isNaN(slot) || slot < 1 || slot > 3) {
    const b3 = subSheet.getRange('B3').getDisplayValue().trim();
    const h3 = subSheet.getRange('H3').getDisplayValue().trim();
    const n3 = subSheet.getRange('N3').getDisplayValue().trim();
    if (!b3) slot = 1;
    else if (!h3) slot = 2;
    else if (!n3) slot = 3;
    else slot = 1;
  }
  
  const slotConfigs = {
    1: { dateCell: 'B2', teacherCell: 'B3', reasonCell: 'C3', detailCell: 'D3', labelCol: 1, subCol: 4 },
    2: { dateCell: 'H2', teacherCell: 'H3', reasonCell: 'I3', detailCell: 'J3', labelCol: 7, subCol: 10 },
    3: { dateCell: 'N2', teacherCell: 'N3', reasonCell: 'O3', detailCell: 'P3', labelCol: 13, subCol: 16 }
  };
  
  const cfg = slotConfigs[slot];
  
  if (data.date) {
    subSheet.getRange(cfg.dateCell).setValue(normalizeDateStr(data.date));
  }
  
  subSheet.getRange(cfg.teacherCell).setValue(data.teacher.trim());
  if (data.reason) {
    subSheet.getRange(cfg.reasonCell).setValue(data.reason.trim());
  }
  if (data.reasonDetail) {
    subSheet.getRange(cfg.detailCell).setValue(data.reasonDetail.trim());
  }
  
  const rows = [7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39];
  for (let r = 0; r < rows.length; r++) {
    subSheet.getRange(rows[r], cfg.subCol).setValue('');
  }
  
  let subCount = 0;
  if (data.substitutes && Array.isArray(data.substitutes)) {
    const slotLabels = rows.map(r => subSheet.getRange(r, cfg.labelCol).getDisplayValue().trim());
    for (let s = 0; s < data.substitutes.length; s++) {
      const subItem = data.substitutes[s];
      const pTarget = String(subItem.period || '').trim();
      const sTeacher = String(subItem.subTeacher || '').trim();
      if (!pTarget || !sTeacher) continue;
      
      for (let r = 0; r < rows.length; r++) {
        if (slotLabels[r] === pTarget || slotLabels[r] === ('第' + pTarget + '節')) {
          subSheet.getRange(rows[r], cfg.subCol).setValue(sTeacher);
          subCount++;
          break;
        }
      }
    }
  }
  
  SpreadsheetApp.flush();
  
  const slotName = (slot === 1 ? '左側' : (slot === 2 ? '中間' : '右側')) + '代課紙';
  return {
    success: true,
    message: `已成功直接寫入「代課表格」之 ${slotName}！課堂及當值內容已由動態連動公式即時呈現。`,
    slot: slot,
    slotName: slotName,
    teacher: data.teacher,
    date: data.date,
    reason: data.reason,
    assignedSubstitutesCount: subCount
  };
}

/**
 * 彈窗說明代課表格管理支援
 */
function showWriteSubstituteDialog() {
  const html = `
    <div style="font-family:sans-serif; padding:15px; line-height:1.6;">
      <h3 style="color:#0d652d; margin-top:0;">📋 代課表格動態連動與 Web App 直寫</h3>
      <p>「代課表格」現已具備即時動態查詢功能：</p>
      <ul>
        <li><b>自動課表查詢：</b>填入日期與請假教師後，系統自動連動「最新課表」與「排課資料庫」。</li>
        <li><b>當值自動反查：</b>早會前、班主任節、小息、午膳及放學當值由「duty」表即時帶出。</li>
        <li><b>Web App 直接寫入：</b>行動端或系統表單可透過 API 直接指定欄位寫入請假紀錄與代課老師分配。</li>
      </ul>
      <p style="text-align:center; margin-top:20px;">
        <button onclick="google.script.host.close()" style="padding:8px 18px; background:#0d652d; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">知道了</button>
      </p>
    </div>
  `;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(300), '代課表格管理功能');
}

/**
 * 11. Web App 批次調課處理核心函式 (支援課堂與當值雙向調動)
 */
function swapLessonsBatch(swaps) {
  if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
    return { success: false, message: '無調課資料可處理！' };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dbSheet = ss.getSheetByName('排課資料庫');
  const tempSheet = ss.getSheetByName('調課暫存');
  
  if (!tempSheet) {
    return { success: false, message: '找不到「調課暫存」工作表！' };
  }
  
  const dbData = dbSheet ? dbSheet.getRange('A2:E' + dbSheet.getLastRow()).getValues() : [];
  const swapEntries = [];
  const usedPartnerPeriods = new Set();
  
  for (let i = 0; i < swaps.length; i++) {
    const item = swaps[i];
    const origDateStr = normalizeDateStr(String(item.origDate || '').trim());
    const targetDateStr = item.targetDate ? normalizeDateStr(String(item.targetDate).trim()) : origDateStr;
    const period = String(item.period || '').trim();
    let className = String(item.className || '').trim();
    const origLesson = String(item.origLesson || '').trim();
    const applicantTeacher = String(item.applicantTeacher || '').trim();
    const partnerTeacher = String(item.partnerTeacher || '').trim();
    const targetLesson = String(item.targetLesson || '').trim();
    let partnerPeriod = String(item.partnerPeriod || '').trim();
    
    if (!origDateStr || !period || !applicantTeacher || !partnerTeacher) continue;
    
    if (!className) {
      const cm = targetLesson.match(/^([1-6][A-D])/) || origLesson.match(/^([1-6][A-D])/);
      if (cm) className = cm[1];
      else if (targetLesson.includes(':')) className = targetLesson.split(':')[1].trim();
      else className = targetLesson || origLesson;
    }
    if (!className) continue;
    
    const origDateObj = parseDateRobust(origDateStr);
    const origDow = getDayOfWeek(origDateObj);
    
    const targetDateObj = parseDateRobust(targetDateStr);
    const targetDow = getDayOfWeek(targetDateObj);
    
    const isCrossDay = (origDateStr !== targetDateStr);
    
    const key1 = origDateStr + '_' + className + '_' + period;
    swapEntries.push({
      date: origDateStr,
      dow: origDow,
      period: period,
      className: className,
      origTeacher: applicantTeacher,
      newTeacher: partnerTeacher,
      newLesson: targetLesson,
      swapType: isCrossDay ? '跨天調動' : '課堂調動',
      key: key1
    });
    
    if (!partnerPeriod) {
      if (targetLesson.includes(':')) {
        const m = targetLesson.split(':')[0].match(/(早會前|班主任節|第一小息|第二小息|小息1|小息2|午膳|午息|放學當值|放學|\d+)/);
        if (m) partnerPeriod = m[1];
      } else if (period === '放學' || period.includes('當值')) {
        partnerPeriod = period;
      } else if (dbData.length > 0) {
        for (let d = 0; d < dbData.length; d++) {
          const candP = String(dbData[d][2]).trim();
          if (dbData[d][0] == className && dbData[d][1] == targetDow && dbData[d][3] == targetLesson && dbData[d][4] == partnerTeacher && !usedPartnerPeriods.has(candP)) {
            partnerPeriod = candP;
            usedPartnerPeriods.add(candP);
            break;
          }
        }
      }
    }
    
    if (partnerPeriod) {
      const partnerLesson = (period === '放學' || String(period).indexOf('當值') !== -1) ? (isCrossDay ? (origDow + period + ':' + className) : (period + ':' + className)) : origLesson;
      const key2 = targetDateStr + '_' + className + '_' + partnerPeriod;
      swapEntries.push({
        date: targetDateStr,
        dow: targetDow,
        period: partnerPeriod,
        className: className,
        origTeacher: partnerTeacher,
        newTeacher: applicantTeacher,
        newLesson: partnerLesson,
        swapType: isCrossDay ? '跨天調動' : '課堂調動',
        key: key2
      });
    }
  }
  
  if (swapEntries.length === 0) {
    return { success: false, message: '未產生任何有效調課條目，請檢查輸入參數。' };
  }
  
  saveSwapEntriesToTemp(swapEntries);
  refreshLatestTimetable();
  
  return {
    success: true,
    message: `成功完成調課處理！共寫入 ${swapEntries.length} 筆調動紀錄。`,
    count: swapEntries.length,
    entries: swapEntries
  };
}

/**
 * 12. Web App GET 請求處理器
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'refresh') {
    refreshLatestTimetable();
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: '最新課表公式已確認' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (e && e.parameter && e.parameter.action === 'teacher') {
    const result = getTeacherDay(e.parameter.teacher, e.parameter.date);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('滬江小學 調課代課')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getTeacherDay(teacher, dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = ss.getSheetByName('排課資料庫');
  const temp = ss.getSheetByName('調課暫存');
  const name = String(teacher || '').trim();
  const date = normalizeDateStr(dateStr || formatDateString(new Date()));
  const dow = getDayOfWeek(parseDateRobust(date));
  if (!db || !name) return { date: date, dow: dow, slots: [] };
  const last = db.getLastRow();
  const rows = last > 1 ? db.getRange(2, 1, last - 1, 5).getValues() : [];
  const swaps = temp && temp.getLastRow() > 1 ? temp.getRange(2, 1, temp.getLastRow() - 1, 9).getValues() : [];
  const slots = [];
  rows.forEach(function(row) {
    if (String(row[1]).trim() !== dow || String(row[4]).trim() !== name) return;
    const className = String(row[0] || '').trim();
    const period = String(row[2] || '').trim();
    let course = String(row[3] || '').trim();
    let who = name;
    let change = '';
    swaps.forEach(function(swap) {
      const swapDate = normalizeDateStr(swap[0]);
      if (swapDate !== date || String(swap[2]).trim() !== period) return;
      if (String(swap[3]).trim() !== className && String(swap[4]).trim() !== name) return;
      if (String(swap[4]).trim() === name) {
        who = String(swap[5] || '').trim();
        course = String(swap[6] || course).trim();
        change = String(swap[7] || '').trim();
      }
    });
    slots.push({ period: period, className: className, course: course, teacher: who, change: change });
  });
  swaps.forEach(function(swap) {
    if (normalizeDateStr(swap[0]) !== date || String(swap[5]).trim() !== name) return;
    slots.push({
      period: String(swap[2] || '').trim(),
      className: String(swap[3] || '').trim(),
      course: String(swap[6] || '').trim(),
      teacher: name,
      change: String(swap[7] || '').trim()
    });
  });
  return { date: date, dow: dow, teacher: name, slots: slots };
}

function deleteSwapEntriesByKey(keys) {
  if (!keys || !keys.length) return { success: false, message: '沒有可刪除的調課暫存鍵。' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tempSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('調課暫存');
    if (!tempSheet) return { success: false, message: '找不到「調課暫存」工作表！' };
    const lastRow = Math.max(tempSheet.getLastRow(), 1);
    const width = 10;
    const existing = lastRow > 1 ? tempSheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    const drop = {};
    for (var i = 0; i < keys.length; i++) drop[String(keys[i])] = true;
    const kept = existing.filter(function(row) { return !drop[String(row[8] || '')]; });
    if (lastRow > 1) tempSheet.getRange(2, 1, lastRow - 1, width).clearContent();
    if (kept.length) tempSheet.getRange(2, 1, kept.length, width).setValues(kept);
    return { success: true, removed: existing.length - kept.length };
  } finally {
    lock.releaseLock();
  }
}

function confirmationPropsKey(id) {
  return 'hj-confirm-' + String(id || '');
}

function readConfirmation(id) {
  var raw = PropertiesService.getScriptProperties().getProperty(confirmationPropsKey(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function pushConfirmationLog(item) {
  var props = PropertiesService.getScriptProperties();
  var items = [];
  try { items = JSON.parse(props.getProperty('hj-confirm-log') || '[]'); } catch (err) { items = []; }
  if (!Array.isArray(items)) items = [];
  items = items.filter(function(row) { return row && row.id !== item.id; });
  items.unshift(item);
  if (items.length > 80) items = items.slice(0, 80);
  props.setProperty('hj-confirm-log', JSON.stringify(items));
}

function listConfirmations() {
  var items = [];
  try { items = JSON.parse(PropertiesService.getScriptProperties().getProperty('hj-confirm-log') || '[]'); } catch (err) { items = []; }
  return { success: true, items: Array.isArray(items) ? items : [] };
}

function markTempConfirmation(keys, marker) {
  if (!keys || !keys.length || !marker) return 0;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('調課暫存');
  if (!sheet) return 0;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow < 2) return 0;
  var keyCol = sheet.getRange(2, 9, lastRow - 1, 1).getValues();
  var want = {};
  for (var i = 0; i < keys.length; i++) want[String(keys[i])] = true;
  var marked = 0;
  for (var r = 0; r < keyCol.length; r++) {
    if (want[String(keyCol[r][0] || '')]) {
      sheet.getRange(r + 2, 10).setValue(marker);
      marked++;
    }
  }
  return marked;
}

function finishConfirmation(payload) {
  var who = String(payload.who || '').replace(/\|/g, ' ');
  var when = String(payload.when || '');
  var id = String(payload.id || '');
  var marker = '已確定|' + who + '|' + when + '|' + id;
  markTempConfirmation(payload.keys || [], marker);
  var log = payload.log || {};
  log.id = id;
  log.who = who;
  log.when = when;
  log.state = 'done';
  log.sheetWritten = true;
  pushConfirmationLog(log);
  PropertiesService.getScriptProperties().setProperty(confirmationPropsKey(id), JSON.stringify(log));
  return log;
}

/**
 * 同事按下確定後寫入調課暫存。同一安排編號只會執行一次。
 * 兩人對調走 swapLessonsBatch；代課與多方走 writeTempEntries 的同一寫入。
 */
function applyConfirmedArrangement(payload) {
  var id = String(payload.id || '');
  if (!id) return { success: false, applied: false, message: '缺少安排編號。' };
  var gate = LockService.getScriptLock();
  gate.waitLock(30000);
  var existing = readConfirmation(id);
  if (existing && (existing.state === 'done' || (existing.state === 'pending' && existing.started && (Date.now() - existing.started) < 120000))) {
    gate.releaseLock();
    return { success: true, already: true, applied: true, message: '這項安排已經確定，不會再寫一次。', confirmation: existing };
  }
  PropertiesService.getScriptProperties().setProperty(confirmationPropsKey(id), JSON.stringify({ state: 'pending', id: id, started: Date.now() }));
  gate.releaseLock();
  try {
    if (payload.swap && payload.swap.swaps) {
      var swapped = swapLessonsBatch(payload.swap.swaps);
      if (!swapped || swapped.success === false) {
        PropertiesService.getScriptProperties().deleteProperty(confirmationPropsKey(id));
        return { success: false, applied: false, message: (swapped && swapped.message) || '調課沒有寫入。' };
      }
    }
    if (payload.entries && payload.entries.entries && payload.entries.entries.length) {
      saveSwapEntriesToTemp(payload.entries.entries.map(function(entry) {
        return {
          date: entry.date,
          dow: entry.dow,
          period: String(entry.period || ''),
          className: entry.className,
          origTeacher: entry.origTeacher,
          newTeacher: entry.newTeacher,
          newLesson: entry.newLesson,
          swapType: entry.swapType || entry.type,
          key: entry.key
        };
      }));
      refreshLatestTimetable();
    }
    if (payload.cover && payload.cover.teacher) {
      var covered = writeSubstituteTable(payload.cover);
      if (!covered || covered.success === false) {
        PropertiesService.getScriptProperties().deleteProperty(confirmationPropsKey(id));
        return { success: false, applied: false, message: (covered && covered.message) || '代課表格沒有寫入。' };
      }
    }
    var confirmation = finishConfirmation(payload);
    return { success: true, already: false, applied: true, message: '已確定並寫入調課暫存。', confirmation: confirmation };
  } catch (err) {
    PropertiesService.getScriptProperties().deleteProperty(confirmationPropsKey(id));
    return { success: false, applied: false, message: String(err) };
  }
}

function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }
    
    if (payload.action === 'listConfirmations') {
      return ContentService.createTextOutput(JSON.stringify(listConfirmations()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'applyConfirmedArrangement') {
      var applied = applyConfirmedArrangement(payload);
      return ContentService.createTextOutput(JSON.stringify(applied))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'deleteTempEntries') {
      const keys = Array.isArray(payload.keys) ? payload.keys : [];
      const result = deleteSwapEntriesByKey(keys);
      if (!result.success) {
        return ContentService.createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      }
      refreshLatestTimetable();
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: '已刪除 ' + result.removed + ' 筆調課暫存，並刷新最新課表。',
        count: result.removed
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'writeTempEntries') {
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      if (!entries.length) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: '沒有可寫入的調課暫存列。' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      saveSwapEntriesToTemp(entries.map(function(entry) {
        return {
          date: entry.date,
          dow: entry.dow,
          period: String(entry.period || ''),
          className: entry.className,
          origTeacher: entry.origTeacher,
          newTeacher: entry.newTeacher,
          newLesson: entry.newLesson,
          swapType: entry.swapType || entry.type,
          key: entry.key
        };
      }));
      refreshLatestTimetable();
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: '已寫入 ' + entries.length + ' 筆調課暫存，並刷新最新課表。',
        count: entries.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'writeSubstitute' || payload.type === 'substitute' || (payload.teacher && payload.date && (payload.slot || payload.reason))) {
      const result = writeSubstituteTable(payload);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const swaps = payload.swaps ? payload.swaps : [payload];
    const result = swapLessonsBatch(swaps);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 14. 彈窗顯示 Web App 部署說明
 */
function showWebAppInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const msg = 
    '【Web App 部署與使用指南】\n\n' +
    '1. 點選試算表上方「擴充功能」>「Apps Script」。\n' +
    '2. 點選右上角「部署」(Deploy) >「新增部署」(New deployment) 或「管理部署」。\n' +
    '3. 類型選擇「網頁應用程式」(Web app)。\n' +
    '4. 「執行身分」選擇「我 (Me)」，「誰可以存取」選擇「任何人」或「您所屬機構」。\n' +
    '5. 複製生成的專屬 Web App 網址。\n\n' +
    '💡 未來在手機或電腦開啟該網址，即可：\n' +
    '  - 📋 直接填寫並寫入「代課表格」，課表與當值即時動態連動！\n' +
    '  - ⚡ 進行跨天/同日快速調課，最新課表與調課暫存庫同步更新！';
  SpreadsheetApp.getUi().alert('🌐 Web App 即時調課/代課使用說明', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 15. 一鍵清空調課與代課表格 (clearAllSubAndSwapSheets)
 */
function clearAllSubAndSwapSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let clearedCount = 0;

  const subSheet = ss.getSheetByName('代課表格');
  if (subSheet) {
    const subRanges = [
      'B2:E3', 'B7:E39',
      'H2:K3', 'H7:K39',
      'N2:Q3', 'N7:Q39'
    ];
    subRanges.forEach(r => clearSheetRangeSafe(subSheet, r));
    clearedCount++;
  }

  const fullManualSheet = ss.getSheetByName('全手入調課紙_無任何公式');
  if (fullManualSheet) {
    const fullRanges = [
      'B2:F2', 'B4:F21',
      'I2:M2', 'I4:M21',
      'P2:T2', 'P4:T21',
      'W2:AA2', 'W4:AA21'
    ];
    fullRanges.forEach(r => clearSheetRangeSafe(fullManualSheet, r));
    clearedCount++;
  }

  const crossDaySheet = ss.getSheetByName('手入調課紙_跨日調課');
  if (crossDaySheet) {
    const crossRanges = [
      'B2:F2',
      'B5:F21',
      'G5:K21'
    ];
    crossRanges.forEach(r => clearSheetRangeSafe(crossDaySheet, r));
    clearedCount++;
  }

  const subPaperSheet = ss.getSheetByName('代課紙');
  if (subPaperSheet) {
    clearSheetRangeSafe(subPaperSheet, 'B5:K21');
    clearedCount++;
  }

  const swapPaperSheet = ss.getSheetByName('調課紙');
  if (swapPaperSheet) {
    clearSheetRangeSafe(swapPaperSheet, 'B5:J21');
    clearedCount++;
  }

  SpreadsheetApp.flush();
  ss.toast(`✅ 一鍵清空完成！已成功重置 ${clearedCount} 個調課/代課工作表之手動填寫資料，所有公式、表頭與格式樣式均完好保留。`, '清空成功', 5);
}

/**
 * 安全清空指定範圍之輔助函式 (保留所有公式與格式)
 */
function clearSheetRangeSafe(sheet, rangeA1) {
  if (!sheet) return;
  const range = sheet.getRange(rangeA1);
  const formulas = range.getFormulas();
  const values = range.getValues();
  let hasChange = false;

  for (let r = 0; r < formulas.length; r++) {
    for (let c = 0; c < formulas[0].length; c++) {
      if (formulas[r][c]) {
        values[r][c] = formulas[r][c];
      } else {
        if (values[r][c] !== '') {
          values[r][c] = '';
          hasChange = true;
        }
      }
    }
  }

  if (hasChange) {
    range.setValues(values);
  }
}