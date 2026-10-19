import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/shared/engine';
import { ask } from '../../src/client/nlq/execute';
import { parse } from '../../src/client/nlq/parser';

const view = () => {
  const e = Engine.create(21);
  for (let i = 0; i < 8; i++) e.tick();
  return { e, v: e.viewFor('blue') };
};

describe('NLQ parser', () => {
  it('classifies intents', () => {
    const cases: [string, string][] = [
      ['sitrep', 'status'],
      ['how are we doing?', 'status'],
      ['where are my carriers?', 'locate'],
      ['show enemy subs', 'locate'],
      ['what threatens Panama?', 'threat'],
      ['status of Suez', 'node'],
      ['send destroyers to Gibraltar', 'command'],
      ['strike the enemy carrier with bombers', 'command'],
      ['what should I do?', 'recommend'],
      ['how do I win', 'objectives'],
      ['zoom to Europe', 'view'],
      ['pause', 'game'],
      ['build a destroyer', 'buy'],
      ['help', 'help'],
    ];
    for (const [q, intent] of cases) expect(parse(q, [], []).intent, q).toBe(intent);
  });

  it('splits subject and target', () => {
    const p = parse('strike the enemy carrier with bombers', [], []);
    expect(p.verb).toBe('attack');
    expect(p.types).toContain('bomber');
    expect(p.targetTypes).toContain('carrier');
  });

  it('recognises callsigns and nodes', () => {
    const p = parse('send lance to gibraltar', ['DDG LANCE', 'VIPER-1'], []);
    expect(p.callsigns).toEqual(['DDG LANCE']);
    expect(p.nodes).toEqual(['gibraltar']);
  });
});

describe('NLQ executor', () => {
  it('locates our carriers', () => {
    const { v } = view();
    const a = ask('where are my carriers?', v);
    expect(a.highlight?.length).toBe(1);
    expect(a.text).toMatch(/carrier/i);
  });

  it('builds a confirmable move order that the engine accepts', () => {
    const { e, v } = view();
    const a = ask('send destroyers to Gibraltar', v);
    const confirm = a.actions?.find((x) => x.label === 'Confirm');
    expect(confirm?.cmds?.length).toBeGreaterThan(0);
    for (const c of confirm!.cmds!) expect(e.command('blue', c).ok).toBe(true);
  });

  it('handles requisition, objectives, recommendations and fallback', () => {
    const { v } = view();
    expect(ask('build a destroyer', v).actions?.[0].cmd?.type).toBe('buy');
    expect(ask('how do I win?', v).text).toMatch(/1000 VP/);
    expect(ask('what should I do?', v).actions?.length).toBeGreaterThan(0);
    expect(ask('tell me a joke about penguins', v).fallback).toBe(true);
  });
});
