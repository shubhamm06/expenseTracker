import { readFileSync, unlinkSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export async function parsePdf(filePath, password) {
  let targetPath = filePath;
  let decryptedPath = null;

  // Check if PDF is encrypted using qpdf
  const isEncrypted = checkIfEncrypted(filePath);

  if (isEncrypted && !password) {
    throw new Error('PASSWORD_REQUIRED');
  }

  if (password) {
    decryptedPath = filePath + '.decrypted.pdf';
    try {
      execFileSync('qpdf', [
        '--password=' + password,
        '--decrypt',
        filePath,
        decryptedPath,
      ]);
      targetPath = decryptedPath;
    } catch (err) {
      const stderr = err.stderr?.toString() || '';
      // Check for successful decryption with warnings FIRST (exit code 3)
      if (existsSync(decryptedPath) && stderr.includes('succeeded with warnings')) {
        targetPath = decryptedPath;
      } else if (stderr.includes('invalid password')) {
        throw new Error('INVALID_PASSWORD');
      } else {
        throw new Error('DECRYPT_FAILED: ' + (stderr || err.message));
      }
    }
  }

  try {
    const buffer = readFileSync(targetPath);
    const data = await pdf(buffer);
    return { text: data.text, pages: data.numpages };
  } catch (err) {
    if (err.message && (err.message.includes('encrypted') || err.message.includes('password'))) {
      throw new Error('PASSWORD_REQUIRED');
    }
    throw err;
  } finally {
    if (decryptedPath) {
      try { unlinkSync(decryptedPath); } catch {}
    }
  }
}

function checkIfEncrypted(filePath) {
  try {
    const output = execFileSync('qpdf', ['--is-encrypted', filePath], { encoding: 'utf-8' });
    return true;
  } catch (err) {
    // Exit code 2 means not encrypted, 0 means encrypted
    if (err.status === 2) return false;
    return true;
  }
}

export function extractSourceFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ');

  const banks = [
    { patterns: [/\bHDFC\b/i], name: 'HDFC' },
    { patterns: [/\bICICI\b/i], name: 'ICICI' },
    { patterns: [/\bSBI\b/i, /State Bank of India/i], name: 'SBI' },
    { patterns: [/\bAxis\b/i], name: 'AXIS' },
    { patterns: [/\bKotak\b/i], name: 'KOTAK' },
    { patterns: [/\bYes\s*Bank\b/i], name: 'YES' },
    { patterns: [/\bIndusInd\b/i], name: 'INDUSIND' },
    { patterns: [/\bPNB\b/i, /Punjab National/i], name: 'PNB' },
    { patterns: [/\bBOB\b/i, /Bank of Baroda/i], name: 'BOB' },
    { patterns: [/\bCanara\b/i], name: 'CANARA' },
    { patterns: [/\bIDFC\b/i], name: 'IDFC' },
    { patterns: [/\bRBL\b/i], name: 'RBL' },
    { patterns: [/\bFederal\s*Bank\b/i], name: 'FEDERAL' },
    { patterns: [/\bAU\s*(Small\s*Finance)?\s*Bank\b/i], name: 'AU' },
    { patterns: [/\bCiti\b/i], name: 'CITI' },
    { patterns: [/\bAmerican\s*Express\b/i, /\bAmex\b/i], name: 'AMEX' },
    { patterns: [/\bSC\b.*\bStandard\s*Chartered\b/i, /\bStandard\s*Chartered\b/i], name: 'SC' },
    { patterns: [/\bHSBC\b/i], name: 'HSBC' },
    { patterns: [/\bDBS\b/i], name: 'DBS' },
    { patterns: [/\bOneCard\b/i], name: 'ONECARD' },
    { patterns: [/\bSlice\b/i], name: 'SLICE' },
    { patterns: [/\bFi\b/], name: 'FI' },
    { patterns: [/\bJupiter\b/i], name: 'JUPITER' },
    { patterns: [/\bNiyo\b/i], name: 'NIYO' },
  ];

  let bankName = null;
  for (const bank of banks) {
    for (const pattern of bank.patterns) {
      if (pattern.test(fullText)) {
        bankName = bank.name;
        break;
      }
    }
    if (bankName) break;
  }

  const last4 = extractLast4Digits(fullText, lines, bankName);

  if (!bankName && !last4) return null;
  if (bankName && last4) return `${bankName}-${last4}`;
  if (bankName) return bankName;
  return `CARD-${last4}`;
}

function extractLast4Digits(fullText, lines, bankName) {
  // AMEX uses 15-digit format: XXXX-XXXXXX-X1234
  const amexPatterns = [
    /\b\d{4}[\s\-]+\d{6}[\s\-]+\d(\d{4})\b/,
    /\bXXXX[\s\-]*XXXXXX[\s\-]*X(\d{4})\b/i,
    /\b[*xX]{4}[\s\-]*[*xX]{6}[\s\-]*[*xX](\d{4})\b/,
    /\b\.{4}[\s\-]*\.{6}[\s\-]*\.(\d{4})\b/,
  ];

  // Standard 16-digit card patterns (various masking styles)
  const cardPatterns = [
    // "Card No" / "Card Number" / "Account No" followed by masked+last4
    /(?:card|acct|account|a\/c|credit\s*card)[\s#:.\-]*(?:no\.?|number|num)?[\s#:.\-]*(?:[*xX.]{4}[\s\-]*){2,3}(\d{4})\b/i,
    /(?:card|acct|account|a\/c|credit\s*card)[\s#:.\-]*(?:no\.?|number|num)?[\s#:.\-]*\d{4}[\s\-]*(?:[*xX.]{4}[\s\-]*){2}(\d{4})\b/i,
    // "ending with/in 1234" or "ending 1234"
    /\b(?:ending|ends)\s*(?:in|with)?\s*(\d{4})\b/i,
    /\b(?:last\s*4\s*digits?)\s*[:.\-]?\s*(\d{4})\b/i,
    // Full masked 16-digit: "XXXX XXXX XXXX 1234" or "****-****-****-1234"
    /\b[*xX]{4}[\s\-]+[*xX]{4}[\s\-]+[*xX]{4}[\s\-]+(\d{4})\b/,
    // Dots as masking: ".... .... .... 1234"
    /\.{3,4}[\s\-]+\.{3,4}[\s\-]+\.{3,4}[\s\-]+(\d{4})\b/,
    // "4567 89XX XXXX 1234" (partially visible first digits)
    /\b\d{4}[\s\-]+\d{2}[*xX]{2}[\s\-]+[*xX]{4}[\s\-]+(\d{4})\b/,
    /\b\d{4}[\s\-]+[*xX]{4}[\s\-]+[*xX]{4}[\s\-]+(\d{4})\b/,
    // Continuous masked: "XXXXXXXXXXXX1234" or "************1234"
    /[*xX]{8,12}(\d{4})\b/,
    // "Card No. .... .... .... 1234" with dots
    /(?:card|acct|account)[\s#:.\-]*(?:no\.?|number)?[\s#:.\-]*\.+[\s.]*\.+[\s.]*\.+[\s.]*(\d{4})\b/i,
    // "XX1234" short form (6 char) sometimes used in HDFC
    /\b[*xX]{2}(\d{4})\b/,
  ];

  // Search line by line first (more context-aware, avoids false positives)
  const contextPatterns = [
    /(?:card|account|credit|statement).*?(\d{4})\s*$/i,
  ];

  const patternsToUse = bankName === 'AMEX'
    ? [...amexPatterns, ...cardPatterns]
    : [...cardPatterns, ...amexPatterns];

  // First pass: search each line for card-related context + number
  for (const line of lines) {
    if (!/card|account|acct|a\/c|credit|ending|number|no\./i.test(line)) continue;
    for (const pattern of patternsToUse) {
      const match = line.match(pattern);
      if (match && match[1] && /^\d{4}$/.test(match[1])) {
        if (!isLikelyYear(match[1])) return match[1];
      }
    }
  }

  // Second pass: search full text
  for (const pattern of patternsToUse) {
    const match = fullText.match(pattern);
    if (match && match[1] && /^\d{4}$/.test(match[1])) {
      if (!isLikelyYear(match[1])) return match[1];
    }
  }

  return null;
}

function isLikelyYear(digits) {
  const num = parseInt(digits, 10);
  return num >= 1990 && num <= 2040;
}

export function extractTransactionsFromText(text, detectedSource) {
  const source = detectedSource || extractSourceFromText(text);
  if (source && source.startsWith('HSBC')) {
    const result = extractHsbcTransactions(text);
    if (result.length > 0) return result;
  }
  if (source && source.startsWith('AMEX')) {
    const result = extractAmexTransactions(text);
    if (result.length > 0) return result;
  }
  if (source && source.startsWith('ICICI')) {
    const result = extractIciciTransactions(text);
    if (result.length > 0) return result;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const transactions = [];

  const datePatterns = [
    /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,
    /(\d{2}\s+\w{3}\s+\d{4})/,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{2})/,
  ];

  const amountPattern = /[\d,]+\.\d{2}/g;
  const pointsContextPattern = /\b(points?|pts?|reward|bonus)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let dateMatch = null;

    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        dateMatch = match[1];
        break;
      }
    }

    if (!dateMatch) continue;

    const amounts = [];
    let match;
    while ((match = amountPattern.exec(line)) !== null) {
      amounts.push({ value: match[0], index: match.index });
    }
    amountPattern.lastIndex = 0;

    if (amounts.length === 0) continue;

    const selectedAmount = pickTransactionAmount(amounts, line);
    if (!selectedAmount) continue;

    const parsedAmount = parseFloat(selectedAmount.value.replace(/,/g, ''));
    if (parsedAmount < 1.0) continue;

    const dateEndIdx = line.indexOf(dateMatch) + dateMatch.length;
    const amountStartIdx = selectedAmount.index;
    let description = line.substring(dateEndIdx, amountStartIdx).trim();

    description = description.replace(/\s+/g, ' ').replace(/^[\s\-\/]+|[\s\-\/]+$/g, '');

    if (description.length < 2) continue;

    if (/\b(reward\s*points?|loyalty\s*points?|bonus\s*points?|pts?\s*(earned|redeemed|credited))\b/i.test(description)) continue;

    const isCredit = /\b(cr|credit)\b/i.test(line) || line.includes(' Cr');

    transactions.push({
      date: dateMatch,
      description,
      amount: parsedAmount,
      type: isCredit ? 'credit' : 'debit',
    });
  }

  return transactions;
}

function pickTransactionAmount(amounts, line) {
  if (amounts.length === 1) return amounts[0];

  const pointsPattern = /\b(points?|pts?|reward|bonus)\b/i;
  const candidates = amounts.filter(a => {
    const surroundingText = line.substring(Math.max(0, a.index - 15), a.index + a.value.length + 15);
    return !pointsPattern.test(surroundingText);
  });

  const pool = candidates.length > 0 ? candidates : amounts;

  let best = pool[0];
  let bestVal = parseFloat(best.value.replace(/,/g, ''));
  for (let i = 1; i < pool.length; i++) {
    const val = parseFloat(pool[i].value.replace(/,/g, ''));
    if (val > bestVal) {
      best = pool[i];
      bestVal = val;
    }
  }
  return best;
}

function extractHsbcTransactions(text) {
  const lines = text.split('\n');
  const transactions = [];
  const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

  // Extract statement year from period line: "19 APR 2026  To18 MAY 2026"
  let statementYear = null;
  let statementEndMonth = null;
  for (const line of lines) {
    const periodMatch = line.match(/(\d{1,2}\s+\w{3}\s+(\d{4}))\s*To\s*(\d{1,2}\s+(\w{3})\s+(\d{4}))/i);
    if (periodMatch) {
      statementYear = periodMatch[5];
      statementEndMonth = months[periodMatch[4].toUpperCase()];
      break;
    }
  }
  if (!statementYear) {
    const dueDateMatch = text.match(/(\d{1,2}\s+\w{3}\s+(\d{4}))/);
    if (dueDateMatch) statementYear = dueDateMatch[2];
  }
  if (!statementYear) statementYear = new Date().getFullYear().toString();

  // HSBC format: date line (DDMMM), then next non-blank line has description + amount
  const dateLinePattern = /^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i;
  const amountAtEndPattern = /(?:IN|SG|US|GB|AE|HK)?([\d,]+\.\d{2})\s*(CR)?\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const dateMatch = trimmed.match(dateLinePattern);
    if (!dateMatch) continue;

    const day = dateMatch[1].padStart(2, '0');
    const monthStr = dateMatch[2].toUpperCase();
    const month = months[monthStr];
    if (!month) continue;

    // Determine year: if transaction month > statement end month, it's previous year
    let year = statementYear;
    if (statementEndMonth && month > statementEndMonth) {
      year = (parseInt(statementYear) - 1).toString();
    }

    // Find next non-blank line for description + amount
    let descLine = null;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const candidate = lines[j].trim();
      if (candidate && candidate.length > 2) {
        descLine = candidate;
        break;
      }
    }
    if (!descLine) continue;

    const amountMatch = descLine.match(amountAtEndPattern);
    if (!amountMatch) continue;

    const amountStr = amountMatch[1];
    const isCredit = !!amountMatch[2];
    const parsedAmount = parseFloat(amountStr.replace(/,/g, ''));
    if (parsedAmount < 1.0) continue;

    // Description is everything before the amount
    const amountIdx = descLine.lastIndexOf(amountMatch[0]);
    let description = descLine.substring(0, amountIdx).trim();
    // Clean up country code at end if present
    description = description.replace(/\s+(IN|SG|US|GB|AE|HK)\s*$/i, '').trim();
    description = description.replace(/\s+/g, ' ');

    if (description.length < 2) continue;

    const date = `${day}/${month}/${year}`;
    transactions.push({
      date,
      description,
      amount: parsedAmount,
      type: isCredit ? 'credit' : 'debit',
    });
  }

  return transactions;
}

function extractAmexTransactions(text) {
  const lines = text.split('\n');
  const transactions = [];
  const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  // Extract statement year from date like "18/05/2026" or "May 18, 2026"
  let statementYear = null;
  const dateHeaderMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dateHeaderMatch) {
    statementYear = dateHeaderMatch[3];
  } else {
    const longDateMatch = text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(\d{4})/i);
    if (longDateMatch) statementYear = longDateMatch[1];
  }
  if (!statementYear) statementYear = new Date().getFullYear().toString();

  // Amex format: "Month DD<description><amount>"  e.g. "April 19AMAZON                  Mumbai5,000.00"
  const txnPattern = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(.+?)([\d,]+\.\d{2})\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(txnPattern);
    if (!match) continue;

    const monthStr = match[1].toLowerCase();
    const day = match[2].padStart(2, '0');
    const month = months[monthStr];
    if (!month) continue;

    let description = match[3].trim();
    const amountStr = match[4];
    const parsedAmount = parseFloat(amountStr.replace(/,/g, ''));
    if (parsedAmount < 1.0) continue;

    // Skip summary lines
    if (/^new\s+(domestic|international|foreign)\s+transactions/i.test(description)) continue;

    // Clean description
    description = description.replace(/\s+/g, ' ').trim();
    if (description.length < 2) continue;

    // Check next few lines for "CR" indicating credit
    let isCredit = false;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const peek = lines[j].trim();
      if (/^CR$/i.test(peek)) { isCredit = true; break; }
      if (peek.match(txnPattern)) break;
    }

    const date = `${day}/${month}/${statementYear}`;
    transactions.push({
      date,
      description,
      amount: parsedAmount,
      type: isCredit ? 'credit' : 'debit',
    });
  }

  return transactions;
}

function extractIciciTransactions(text) {
  const lines = text.split('\n');
  const transactions = [];

  const txnLinePattern = /^(\d{2}\/\d{2}\/\d{4})(\d{8,15})(.+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(txnLinePattern);
    if (!match) continue;

    const date = match[1];
    let description = match[3].trim();
    let amount = null;

    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nextLine = lines[j].trim();
      if (!nextLine) continue;
      if (/^[A-Z]{2}$/.test(nextLine)) continue;
      if (/^#$/.test(nextLine)) break;
      amount = extractIciciAmount(nextLine);
      break;
    }

    if (!amount) continue;

    const parsedAmount = parseFloat(amount.replace(/,/g, ''));
    if (parsedAmount < 1.0) continue;

    description = description.replace(/\s+(IN|US|SG|GB|AE|HK|AU|JP|NL|DE|FR)\s*$/i, '').trim();
    description = description.replace(/\s+/g, ' ');
    if (description.length < 2) continue;

    const isCredit = /\bCR\b/i.test(lines[i]) || (lines[i + 1] && /\bCR\b/i.test(lines[i + 1].trim()));

    transactions.push({
      date,
      description,
      amount: parsedAmount,
      type: isCredit ? 'credit' : 'debit',
    });
  }

  return transactions;
}

function extractIciciAmount(str) {
  const trimmed = str.trim();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const decimals = trimmed.substring(dotIdx + 1);
  if (decimals.length !== 2 || !/^\d{2}$/.test(decimals)) return null;

  const beforeDot = trimmed.substring(0, dotIdx);
  if (beforeDot.length < 1) return null;

  let pos = beforeDot.length - 1;
  let digitCount = 0;
  while (pos >= 0 && /\d/.test(beforeDot[pos])) {
    digitCount++;
    pos--;
    if (digitCount === 3) break;
  }
  if (digitCount === 0) return null;

  while (pos >= 0 && beforeDot[pos] === ',') {
    pos--;
    let groupDigits = 0;
    while (pos >= 0 && /\d/.test(beforeDot[pos])) {
      groupDigits++;
      pos--;
      if (groupDigits === 2) break;
    }
    if (groupDigits !== 2) {
      pos += groupDigits + 1;
      break;
    }
  }

  const amountStart = pos + 1;
  const amount = trimmed.substring(amountStart, dotIdx + 3);
  if (!amount || !/^\d/.test(amount)) return null;
  return amount;
}


export function extractDueDateFromText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ');

  const months = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
    apr: '04', april: '04', may: '05', jun: '06', june: '06',
    jul: '07', july: '07', aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
  };

  // Patterns for "Month Day, Year" format (e.g., "Due byJune 5, 2026")
  const monthDayYearPatterns = [
    /due\s*(?:by|on|before)\s*(\w{3,9})\s*(\d{1,2}),?\s*(\d{4})/i,
    /(?:payment\s*)?due\s*date\s*[:\-]?\s*(\w{3,9})\s*(\d{1,2}),?\s*(\d{4})/i,
    /pay\s*(?:by|before|on)\s*(\w{3,9})\s*(\d{1,2}),?\s*(\d{4})/i,
    /last\s*date\s*(?:for|of)\s*payment\s*[:\-]?\s*(\w{3,9})\s*(\d{1,2}),?\s*(\d{4})/i,
  ];

  for (const pattern of monthDayYearPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      const monthStr = months[match[1].toLowerCase()];
      if (!monthStr) continue;
      const day = match[2].padStart(2, '0');
      const year = match[3];
      const numMonth = parseInt(monthStr, 10);
      const numDay = parseInt(day, 10);
      if (numMonth < 1 || numMonth > 12 || numDay < 1 || numDay > 31) continue;
      return `${year}-${monthStr}-${day}`;
    }
  }

  // Patterns for "Day Month Year" format (e.g., "due date: 15/06/2026")
  const dueDatePatterns = [
    /(?:payment\s*)?due\s*date\s*[:\-]?\s*(\d{1,2})[\/\-\s](\d{2}|\w{3,9})[\/\-\s](\d{4})/i,
    /(?:total\s*)?(?:amount\s*)?due\s*(?:by|on|before)\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i,
    /pay\s*(?:by|before|on)\s*(\d{1,2})[\/\-](\d{2})[\/\-](\d{4})/i,
    /last\s*date\s*(?:for|of)\s*payment\s*[:\-]?\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i,
    /payment\s*due\s*[:\-]?\s*(\d{1,2})[\/\-](\d{2})[\/\-](\d{4})/i,
    /due\s*on\s*(\d{1,2})[\/\-\s](\w{3,9})[\/\-\s](\d{4})/i,
    /due\s*date[\s\S]{0,30}?(\d{1,2})[\/\-](\d{2})[\/\-](\d{4})/i,
  ];

  for (const pattern of dueDatePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      let month = match[2];
      const year = match[3];

      if (/^\d+$/.test(month)) {
        month = month.padStart(2, '0');
      } else {
        month = months[month.toLowerCase()] || null;
        if (!month) continue;
      }

      const numMonth = parseInt(month, 10);
      const numDay = parseInt(day, 10);
      if (numMonth < 1 || numMonth > 12 || numDay < 1 || numDay > 31) continue;

      return `${year}-${month}-${day}`;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (/due\s*date/i.test(lines[i])) {
      const nearby = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
      const dateMatch = nearby.match(/(\d{1,2})[\/\-\s]((?:\d{2}|\w{3,9}))[\/\-\s](\d{4})/);
      if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        let month = dateMatch[2];
        const year = dateMatch[3];

        if (/^\d+$/.test(month)) {
          month = month.padStart(2, '0');
        } else {
          month = months[month.toLowerCase()] || null;
          if (!month) continue;
        }

        const numMonth = parseInt(month, 10);
        const numDay = parseInt(day, 10);
        if (numMonth < 1 || numMonth > 12 || numDay < 1 || numDay > 31) continue;

        return `${year}-${month}-${day}`;
      }
    }
  }

  return null;
}
