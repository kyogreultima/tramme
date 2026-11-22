// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from '@tramme/project';
import { forgetProjects, keepProjects, lastProjects } from '../src/project-list.ts';

const one = { id: 'film-ab12', name: 'Film', modified: '2026-11-22T10:00:00Z' } as Manifest;

describe('the projects as this device last listed them', () => {
  beforeEach(() => localStorage.clear());

  it('has none before a first list, then the last one kept', () => {
    expect(lastProjects()).toBeNull();
    keepProjects([one]);
    expect(lastProjects()).toEqual([one]);
    keepProjects([]);
    expect(lastProjects()).toEqual([]);
  });

  it('forgets them when someone signs in or out', () => {
    keepProjects([one]);
    forgetProjects();
    expect(lastProjects()).toBeNull();
  });

  it('reads anything else kept under its name as none', () => {
    localStorage.setItem('tramme.projects', '{"not":"a list"}');
    expect(lastProjects()).toBeNull();
    localStorage.setItem('tramme.projects', 'not json');
    expect(lastProjects()).toBeNull();
  });
});
