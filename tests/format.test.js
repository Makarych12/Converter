import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainAmount, plainRate, formatAmount, plainNumber, currencyDigits } from '../js/format.js';

const fiat = (code) => ({ code, kind: 'fiat' });
const crypto = (code) => ({ code, kind: 'crypto' });
const nbsp = (s) => s.replace(/[  ]/g, ' ');

test('чистое число для буфера (ТЗ: 195.58)', () => {
  assert.equal(plainAmount(195.583, fiat('BGN')), '195.58');
  assert.equal(plainAmount(100, fiat('EUR')), '100.00');
  assert.equal(plainAmount(1234567.891, fiat('USD')), '1234567.89');
});
test('валюты без копеек и с тремя знаками', () => {
  assert.equal(currencyDigits('JPY'), 0);
  assert.equal(currencyDigits('KWD'), 3);
  assert.equal(plainAmount(15678.4, fiat('JPY')), '15678');
});
test('мелкие суммы и крипта', () => {
  assert.equal(plainAmount(0.0017031699, crypto('BTC')), '0.001703');
  assert.equal(plainAmount(1.5, crypto('ETH')), '1.50');
  assert.equal(plainAmount(0.004567, fiat('USD')), '0.00457');
});
test('курс (ТЗ: 1.9558)', () => {
  assert.equal(plainRate(1.95583), '1.9558');
  assert.equal(plainRate(90.9231), '90.9231');
  assert.equal(plainRate(175.784), '175.78');
  assert.equal(plainRate(0.0000170317), '0.00001703');
});
test('экранный формат ru-RU', () => {
  assert.equal(nbsp(formatAmount(1234.5, fiat('USD'))), '1 234,50');
});
test('без экспоненты и «-0»', () => {
  assert.equal(plainNumber(1e-7, { min: 0, max: 10 }), '0.0000001');
  assert.equal(plainNumber(-0.0001, { min: 0, max: 2 }), '0');
});
