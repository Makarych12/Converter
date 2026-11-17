/**
 * Smart Expression Parser — безопасный разбор математических выражений без eval().
 *
 * Поддерживается:
 *   + - * /  ^  ( )          — базовые операции и скобки
 *   × · х x  ÷ :             — альтернативные знаки умножения/деления
 *   1 000 000 / 1'000 / 1_000 — разделители разрядов
 *   1,5  1.5  1,234.56  1.234,56 — десятичная запятая или точка
 *   5k / 5к                   — тысячи
 *   100 + 10%  /  200 - 15%   — калькуляторный процент (от левого операнда)
 *   200 * 10%                 — 10% как 0.1
 */

export class ParseError extends Error {
  constructor(message, position = -1) {
    super(message);
    this.name = 'ParseError';
    this.position = position;
  }
}

const OP_ALIASES = {
  '×': '*', '·': '*', '∙': '*', 'x': '*', 'X': '*', 'х': '*', 'Х': '*',
  '÷': '/', ':': '/',
  '−': '-', '–': '-', '—': '-',
  '＋': '+',
};

function normalize(input) {
  return String(input ?? '')
    // все виды пробелов, апострофы и подчёркивания как разделители разрядов
    .replace(/[\s   '’_]/g, '')
    .replace(/[×·∙xXхХ÷:−–—＋]/g, (ch) => OP_ALIASES[ch]);
}

function parseNumberLiteral(raw, pos) {
  const dots = (raw.match(/\./g) || []).length;
  const commas = (raw.match(/,/g) || []).length;
  let s = raw;

  if (dots && commas) {
    // Последний встреченный разделитель — десятичный, второй — разряды.
    const decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    s = raw.split(group).join('');
    if ((s.match(decimal === '.' ? /\./g : /,/g) || []).length > 1) {
      throw new ParseError(`Некорректное число «${raw}»`, pos);
    }
    s = s.replace(',', '.');
  } else if (commas > 1) {
    s = raw.replace(/,/g, '');           // 1,000,000
  } else if (commas === 1) {
    s = raw.replace(',', '.');           // 1,5 — десятичная запятая
  } else if (dots > 1) {
    s = raw.replace(/\./g, '');          // 1.000.000
  }

  if (s === '.' || s === '') throw new ParseError(`Некорректное число «${raw}»`, pos);
  const value = Number(s);
  if (!Number.isFinite(value)) throw new ParseError(`Некорректное число «${raw}»`, pos);
  return value;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[0-9.,]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9.,]/.test(src[i])) i++;
      let value = parseNumberLiteral(src.slice(start, i), start);
      // суффикс тысяч
      if (i < src.length && /[kKкК]/.test(src[i])) {
        value *= 1000;
        i++;
      }
      tokens.push({ type: 'num', value, pos: start });
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      tokens.push({ type: ch, pos: i });
      i++;
      continue;
    }
    throw new ParseError(`Недопустимый символ «${ch}»`, i);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }
  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  eat(type) {
    const t = this.peek();
    if (t && t.type === type) { this.i++; return t; }
    return null;
  }

  // expr := term (('+'|'-') term)*
  parseExpr() {
    let left = this.parseTerm();
    for (;;) {
      const op = this.eat('+') || this.eat('-');
      if (!op) return left;
      const right = this.parseTerm();
      const lv = settle(left);
      if (right.pct) {
        // 100 + 10% → 110
        const delta = lv * right.value / 100;
        left = { value: op.type === '+' ? lv + delta : lv - delta, pct: false };
      } else {
        left = { value: op.type === '+' ? lv + right.value : lv - right.value, pct: false };
      }
    }
  }

  // term := unary (('*'|'/') unary)*
  parseTerm() {
    let left = this.parseUnary();
    for (;;) {
      const op = this.eat('*') || this.eat('/');
      if (!op) return left;
      const right = this.parseUnary();
      const lv = settle(left);
      const rv = settle(right);
      if (op.type === '/') {
        if (rv === 0) throw new ParseError('Деление на ноль', op.pos);
        left = { value: lv / rv, pct: false };
      } else {
        left = { value: lv * rv, pct: false };
      }
    }
  }

  // unary := ('-'|'+') unary | power
  parseUnary() {
    if (this.eat('-')) {
      const v = this.parseUnary();
      return { value: -v.value, pct: v.pct };
    }
    if (this.eat('+')) return this.parseUnary();
    return this.parsePower();
  }

  // power := postfix ('^' unary)?
  parsePower() {
    const base = this.parsePostfix();
    const op = this.eat('^');
    if (!op) return base;
    const exp = this.parseUnary();
    const value = Math.pow(settle(base), settle(exp));
    if (!Number.isFinite(value)) throw new ParseError('Слишком большое число', op.pos);
    return { value, pct: false };
  }

  // postfix := primary '%'?
  parsePostfix() {
    const prim = this.parsePrimary();
    if (this.eat('%')) return { value: settle(prim), pct: true };
    return prim;
  }

  parsePrimary() {
    const t = this.next();
    if (!t) throw new ParseError('Выражение не завершено', -1);
    if (t.type === 'num') return { value: t.value, pct: false };
    if (t.type === '(') {
      const inner = this.parseExpr();
      if (!this.eat(')')) throw new ParseError('Не закрыта скобка', t.pos);
      return { value: settle(inner), pct: false };
    }
    throw new ParseError(`Неожиданный символ «${t.type}»`, t.pos);
  }
}

/** Процент, оставшийся «висеть» (например, «10%» без левого операнда) → доля. */
function settle(node) {
  return node.pct ? node.value / 100 : node.value;
}

/**
 * Вычисляет выражение.
 * @returns {{ok: true, value: number, isExpression: boolean} |
 *           {ok: false, empty?: boolean, error?: string, position?: number}}
 */
export function evaluate(input) {
  const src = normalize(input);
  if (!src) return { ok: false, empty: true };
  try {
    const tokens = tokenize(src);
    const parser = new Parser(tokens);
    const result = parser.parseExpr();
    if (parser.peek()) {
      const t = parser.peek();
      throw new ParseError(t.type === ')' ? 'Лишняя закрывающая скобка' : `Неожиданный символ «${t.type === 'num' ? t.value : t.type}»`, t.pos);
    }
    const value = settle(result);
    if (!Number.isFinite(value)) throw new ParseError('Результат не является числом');
    // «Выражение» — всё, что не является просто числом (в т.ч. с ведущим минусом)
    const isExpression = !(tokens.length === 1 || (tokens.length === 2 && tokens[0].type === '-' && tokens[1].type === 'num'))
      || /[kKкК]/.test(src);
    return { ok: true, value, isExpression };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err.message, position: err.position };
    throw err;
  }
}
