// Deterministic field -> profile mapping rules. No LLM involved.
// Each rule: { key: profile key, test: regex against the normalized label haystack,
//              types: allowed question types }
// The haystack is: label + name + id + placeholder + autocomplete, lowercased.
window.JAF = window.JAF || {};

window.JAF.RULES = [
  // Names
  { key: 'fullName',  test: /\b(full ?name|your name|candidate name|applicant name|name of (the )?(applicant|candidate))\b|^name\b/, types: ['text'] },
  { key: 'firstName', test: /\b(first ?name|given ?name|fname|forename)\b/, types: ['text'] },
  { key: 'lastName',  test: /\b(last ?name|surname|family ?name|lname)\b/, types: ['text'] },
  { key: 'middleName', test: /\b(middle ?name)\b/, types: ['text'] },

  // Contact
  { key: 'email',     test: /\b(e-?mail)\b/, types: ['text', 'email'] },
  { key: 'phone',     test: /\b(phone|mobile|contact (no|number)|cell|whatsapp|tel)\b/, types: ['text', 'tel', 'number'] },
  { key: 'phoneCountryCode', test: /\b(country code|dial code|phone code)\b/, types: ['text', 'tel', 'select', 'combobox'] },

  // Personal
  { key: 'dob',       test: /\b(date of birth|dob|birth ?date|birthday)\b/, types: ['text', 'date'] },
  { key: 'gender',    test: /\b(gender|sex)\b/, types: ['text', 'select', 'radio', 'combobox'] },
  { key: 'nationality', test: /\b(nationality|citizenship)\b/, types: ['text', 'select', 'combobox'] },

  // Location
  { key: 'address',   test: /\b(street|address line|full address|permanent address|current address)\b|^address\b/, types: ['text', 'textarea'] },
  { key: 'city',      test: /\b(city|town|current location|location \(city\)|where are you (based|located))\b/, types: ['text', 'select', 'combobox'] },
  { key: 'state',     test: /\b(state|province)\b/, types: ['text', 'select', 'combobox'] },
  { key: 'country',   test: /\b(country)\b/, types: ['text', 'select', 'combobox'] },
  { key: 'pincode',   test: /\b(pin ?code|zip ?code|postal ?code|postcode|zip)\b/, types: ['text', 'number'] },

  // Links
  { key: 'linkedin',  test: /\blinked ?in\b/, types: ['text', 'url'] },
  { key: 'github',    test: /\bgit ?hub\b/, types: ['text', 'url'] },
  { key: 'portfolio', test: /\b(portfolio|personal (site|website)|website|blog|behance|dribbble)\b/, types: ['text', 'url'] },
  { key: 'leetcode',  test: /\b(leetcode|codeforces|hackerrank|codechef)\b/, types: ['text', 'url'] },

  // Work
  { key: 'currentCompany', test: /\b(current (company|employer|organi[sz]ation)|employer|company name|most recent (company|employer)|where do you (currently )?work)\b/, types: ['text'] },
  { key: 'currentTitle',   test: /\b(current (title|role|position|designation)|job title|designation|current job)\b/, types: ['text'] },
  { key: 'totalExperienceYears', test: /\b(years? of (work |total |professional |relevant )?experience|total experience|experience \(?in years|work experience|yrs? of exp|how many years)\b/, types: ['text', 'number', 'select', 'combobox', 'radio'] },
  { key: 'currentCtc',     test: /\b(current (ctc|salary|compensation|pay|package)|present (ctc|salary)|ctc \(current)\b/, types: ['text', 'number'] },
  { key: 'expectedCtc',    test: /\b(expected (ctc|salary|compensation|pay|package)|salary expectation|desired (salary|compensation|pay)|ctc \(expected)\b/, types: ['text', 'number'] },
  { key: 'noticePeriod',   test: /\b(notice period|how soon can you (join|start)|earliest (joining|start) date|availability to (join|start)|joining time|when can you (join|start))\b/, types: ['text', 'number', 'select', 'radio', 'combobox'] },
  { key: 'skills',         test: /\b(skills?|technologies|tech stack|key skills|core competenc)\b/, types: ['text', 'textarea', 'combobox'] },

  // Education
  { key: 'college',        test: /^(?!.*\b(roll|enrol|registration|reg\.? ?no|student ?id|college ?id|admission)).*\b(college|university|institute|school name|institution|alma mater)\b/, types: ['text', 'combobox'] },
  { key: 'degree',         test: /\b(degree|qualification|highest education|education level)\b/, types: ['text', 'select', 'combobox', 'radio'] },
  { key: 'branch',         test: /\b(branch|major|specialization|specialisation|field of study|stream|discipline)\b/, types: ['text', 'select', 'combobox'] },
  { key: 'graduationYear', test: /\b(graduation year|year of (graduation|passing|completion)|passing year|batch|graduating in)\b/, types: ['text', 'number', 'select', 'combobox'] },
  { key: 'tenthPercentage',   test: /\b(10th|tenth|class[ -]?(10|x)\b|x(th)?[ -](std|standard|grade|board)|sslc|matric(ulation)?|secondary school|\bssc)\b/, types: ['text', 'number', 'select', 'combobox', 'radio'] },
  { key: 'twelfthPercentage', test: /\b(12th|twelfth|class[ -]?(12|xii)\b|xii(th)?[ -](std|standard|grade|board)|hsc|intermediate|higher secondary|senior secondary|\bpuc|pre[- ]university|10\+2)\b/, types: ['text', 'number', 'select', 'combobox', 'radio'] },
  { key: 'rollNumber',     test: /\b(roll ?(no|number|num)|enrol(l)?ment ?(no|number|id)|registration ?(no|number)|reg\.? ?no|student ?id|college ?id|university (roll|reg)|admission (no|number))\b/, types: ['text', 'number'] },
  // Graduation CGPA / percentage: only when the label is not about school (10th / 12th).
  { key: 'cgpa',           test: /^(?!.*\b(10th|12th|tenth|twelfth|class[ -]?(10|12|x|xii)\b|sslc|ssc|hsc|matric|intermediate|secondary|puc|10\+2)).*\b(cgpa|gpa|percentage|aggregate|marks)\b/, types: ['text', 'number', 'select', 'combobox', 'radio'] },

  // Resume
  { key: '__resume',       test: /\b(resume|cv|curriculum vitae)\b/, types: ['file'] },
];

// Labels that talk about somebody other than the candidate, or about a past
// employer, must never be auto-filled from the profile. They go to the LLM.
window.JAF.RULE_EXCLUDE = /\b(reference|referee|emergency|alternate|alternative|secondary (e-?mail|phone|contact|mobile|number)|guardian|parent|father|mother|spouse|recruiter|manager|hr|previous|former|last (employer|company)|ex[- ])\b/;

// Normalize a label into a memory key so "What is your notice period?*" and "notice period" collide.
window.JAF.normalizeLabel = function (s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(please|kindly|the|a|an|your|you|of|to|in|is|are|what|which|do|does)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
