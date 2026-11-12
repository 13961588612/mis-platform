/**
 * useActiveProject.test.ts ?? ????????????2026-09-30??
 *
 * ??????? /get-connections ??? enabled=1????/??????????????
 * ????????????(seed 900001)???????????(test)??????????
 * selectableConnections ??????? id ??? enabled != false?
 */
import { describe, expect, it } from 'vitest';
import { selectableConnections } from './useActiveProject';
import type { Connection } from '../types/modeling';

function conn(partial: Partial<Connection>): Connection {
  return { name: 'x', ...partial } as Connection;
}

describe('selectableConnections', () => {
  it('???? enabled=false ?????', () => {
    const list = [
      conn({ id: 900001, name: 'seed-wren-local', enabled: false }),
      conn({ id: 1790686095967, name: 'test', enabled: true }),
    ];
    const out = selectableConnections(list);
    expect(out.map((c) => c.id)).toEqual([1790686095967]);
  });

  it('enabled ????????????? / ?????', () => {
    const list = [conn({ id: 1, name: 'a' }), conn({ id: 2, name: 'b', enabled: true })];
    expect(selectableConnections(list).map((c) => c.id)).toEqual([1, 2]);
  });

  it('?? id ?????', () => {
    const list = [conn({ id: null, name: 'no-id' }), conn({ id: 5, name: 'ok' })];
    expect(selectableConnections(list).map((c) => c.id)).toEqual([5]);
  });
});
