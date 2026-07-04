import test from 'node:test';
import assert from 'node:assert/strict';

import { snapshotToTui, applySnapshotToTui } from '../src/web-client.js';

test('snapshotToTui maps web pages to CLI problems', () => {
  const snap = {
    demoMode: false,
    tokenMode: 'intrinsic',
    tokens: [{ name: 'color/#ff6b35', type: 'color', value: '#ff6b35' }],
    pages: [{
      id: 'landing',
      name: 'Landing',
      srcFile: 'landing.css',
      src: '.btn { color: red; }',
      html: '<button class="btn">Go</button>',
      drifts: [{
        id: 1,
        type: 'color',
        category: 'value-drift',
        severity: 'high',
        problem: 'Wrong red',
        solution: 'Use brand orange',
        expected: '#ff6b35',
        actualValues: ['red'],
        locations: [{ file: 'landing.css', line: 1, selector: '.btn', prop: 'color', value: 'red' }],
      }],
    }],
  };
  const sources = [{ id: 'landing', name: 'Landing', path: '/proj/src/landing.css', file: 'landing.css' }];
  const { pages, problems } = snapshotToTui(snap, sources);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, '/proj/src/landing.css');
  assert.equal(pages[0].src, undefined);
  assert.equal(pages[0].text, undefined);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].drift.problem, 'Wrong red');
});

test('applySnapshotToTui preserves page and drift selection when possible', () => {
  const snap = {
    tokenMode: 'intrinsic',
    tokens: [],
    pages: [{
      id: 'a',
      name: 'A',
      srcFile: 'a.css',
      src: 'x',
      drifts: [{ id: 1, type: 'color', category: 'value-drift', severity: 'low', problem: 'p', solution: 's', actualValues: ['#000'], locations: [{ file: 'a.css', line: 1, selector: '.x' }] }],
    }],
  };
  const prev = {
    pages: [{ id: 'a', name: 'A', file: 'a.css', text: 'x', src: 'x' }],
    problems: [{ page: { id: 'a' }, drift: { id: 1 } }],
    curPage: 0,
    idx: 0,
  };
  const next = applySnapshotToTui(snap, [], prev);
  assert.equal(next.curPage, 0);
  assert.equal(next.idx, 0);
  assert.equal(next.problems.length, 1);
});
