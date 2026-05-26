// Generates candidate passwords from user profile and card data.
// Known patterns:
// 1. DDMMYY + last 6 digits of card (e.g., 020670004200)
// 2. First 4 letters of name (lowercase) + DDMM (e.g., shub0604)
// 3. PAN number in uppercase (e.g., ABCPJ1521N)
// Plus additional combos for coverage.

export function generatePasswords(cards, profile) {
  const passwords = [];
  const seen = new Set();

  const name4Upper = (profile.name || '').replace(/\s/g, '').slice(0, 4).toUpperCase();
  const name4Lower = name4Upper.toLowerCase();
  const nameVariants = [name4Lower, name4Upper].filter(Boolean);
  const pan = (profile.pan || '').toUpperCase();
  const dobVariants = getDobVariants(profile.dob);

  function add(password, sourceMatch) {
    if (!password || seen.has(password + '|' + (sourceMatch || ''))) return;
    seen.add(password + '|' + (sourceMatch || ''));
    passwords.push({ password, source_match: sourceMatch });
  }

  for (const card of cards) {
    const cardNum = (card.card_number || '').replace(/\s/g, '');
    const last4 = cardNum.slice(-4);
    const last6 = cardNum.slice(-6);
    if (!last4) continue;
    const sourceMatch = `${card.bank}-${last4}`.toLowerCase();

    // Pattern 1: DDMMYY + last 6 digits (e.g., 020670004200)
    for (const dob of dobVariants) {
      add(`${dob}${last6}`, sourceMatch);
      add(`${dob}${last4}`, sourceMatch);
    }

    // Pattern 2: name4 (lower/upper) + DOB variants
    for (const name4 of nameVariants) {
      for (const dob of dobVariants) {
        add(`${name4}${dob}`, sourceMatch);
      }
      add(`${name4}${last4}`, sourceMatch);
      add(`${name4}${last6}`, sourceMatch);
    }

    // Pattern 3: PAN
    if (pan) {
      add(pan, sourceMatch);
    }
  }

  // Card-independent fallbacks
  if (pan) {
    add(pan, null);
  }
  for (const name4 of nameVariants) {
    for (const dob of dobVariants) {
      add(`${name4}${dob}`, null);
    }
  }
  for (const dob of dobVariants) {
    add(dob, null);
  }

  return passwords;
}

function getDobVariants(dob) {
  if (!dob) return [];
  const parts = dob.split('-');
  if (parts.length !== 3) return [dob.replace(/[-/]/g, '')];

  const [yyyy, mm, dd] = parts;
  const yy = yyyy.slice(-2);

  return [
    `${dd}${mm}${yy}`,    // DDMMYY (most common for banks)
    `${dd}${mm}${yyyy}`,  // DDMMYYYY
    `${dd}${mm}`,          // DDMM
  ];
}
