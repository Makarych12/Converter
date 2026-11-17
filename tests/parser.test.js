import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../js/parser.js';

const v = (s) => {
  const r = evaluate(s);
  assert.ok(r.ok, `ожидался успех для «${s}»: ${r.error}`);
  return r.value;
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('выражение из ТЗ', () => close(v('100 * 1.25 + 50'), 175));
test('скобки и приоритет', () => {
  close(v('(1200-300)/3'), 300);
  close(v('2+3*4'), 14);
  close(v('(2+3)*4'), 20);
  close(v('-(5-8)'), 3);
  close(v('2^10'), 1024);
});
test('десятичная запятая и разделители разрядов', () => {
  close(v('1,5'), 1.5);
  close(v('1 000 000'), 1e6);
  close(v('1 234,56'), 1234.56);
  close(v('1,234.56'), 1234.56);
  close(v('1.234,56'), 1234.56);
  close(v('1.000.000'), 1e6);
  close(v("1'000"), 1000);
});
test('альтернативные операторы', () => {
  close(v('3×4'), 12);
  close(v('3х4'), 12); // кириллическая «х»
  close(v('10÷4'), 2.5);
  close(v('10−4'), 6);
});
test('проценты и суффикс тысяч', () => {
  close(v('2000+15%'), 2300);
  close(v('200-10%'), 180);
  close(v('200*10%'), 20);
  close(v('5k'), 5000);
  close(v('1,5к'), 1500);
});
test('признак выражения', () => {
  assert.equal(evaluate('100').isExpression, false);
  assert.equal(evaluate('-100').isExpression, false);
  assert.equal(evaluate('100+1').isExpression, true);
  assert.equal(evaluate('5k').isExpression, true);
});
test('ошибки', () => {
  assert.equal(evaluate('').empty, true);
  assert.equal(evaluate('   ').empty, true);
  assert.match(evaluate('1/0').error, /ноль/);
  assert.match(evaluate('(1+2').error, /скобка/);
  assert.match(evaluate('1+2)').error, /скобка/);
  assert.equal(evaluate('100 *').ok, false);
  assert.equal(evaluate('abc').ok, false);
  assert.equal(evaluate('alert(1)').ok, false);
});
