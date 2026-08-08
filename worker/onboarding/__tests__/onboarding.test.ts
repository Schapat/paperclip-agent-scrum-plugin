/**
 * Tests for the Onboarding Module
 */

import { describe, it, expect } from 'vitest';
import {
  SCRUM_AGENTS,
  SCRUM_LABELS,
  createAgentInstructions,
  createOnboardingLogger,
  type ScrumRole,
} from '../onboarding';

describe('Onboarding Module', () => {
  describe('SCRUM_AGENTS', () => {
    it('should define exactly 6 agents', () => {
      expect(SCRUM_AGENTS).toHaveLength(6);
    });

    it('should have all required roles', () => {
      const roles = SCRUM_AGENTS.map((a) => a.role);
      expect(roles).toContain('product_owner');
      expect(roles).toContain('scrum_master');
      expect(roles).toContain('technical_lead');
      expect(roles).toContain('developer');
      expect(roles).toContain('developer_2');
      expect(roles).toContain('qa_engineer');
    });

    it('should have correct reporting structure', () => {
      const agentMap = new Map(SCRUM_AGENTS.map((a) => [a.role, a]));

      // PO, SM, TL, QA report to CEO (null)
      expect(agentMap.get('product_owner')?.reportsToRole).toBeNull();
      expect(agentMap.get('scrum_master')?.reportsToRole).toBeNull();
      expect(agentMap.get('technical_lead')?.reportsToRole).toBeNull();
      expect(agentMap.get('qa_engineer')?.reportsToRole).toBeNull();

      // Developers report to Technical Lead
      expect(agentMap.get('developer')?.reportsToRole).toBe('technical_lead');
      expect(agentMap.get('developer_2')?.reportsToRole).toBe('technical_lead');
    });

    it('should have required fields for each agent', () => {
      for (const agent of SCRUM_AGENTS) {
        expect(agent.name).toBeTruthy();
        expect(agent.role).toBeTruthy();
        expect(agent.title).toBeTruthy();
        expect(agent.icon).toBeTruthy();
        expect(agent.capabilities).toBeTruthy();
      }
    });
  });

  describe('SCRUM_LABELS', () => {
    it('should define exactly 6 labels', () => {
      expect(SCRUM_LABELS).toHaveLength(6);
    });

    it('should have all required label names', () => {
      const names = SCRUM_LABELS.map((l) => l.name);
      expect(names).toContain('epic');
      expect(names).toContain('feature');
      expect(names).toContain('story');
      expect(names).toContain('bug');
      expect(names).toContain('improvement');
      expect(names).toContain('scrum-event');
    });

    it('should have valid hex colors', () => {
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
      for (const label of SCRUM_LABELS) {
        expect(label.color).toMatch(hexColorRegex);
      }
    });

    it('should have descriptions for all labels', () => {
      for (const label of SCRUM_LABELS) {
        expect(label.description).toBeTruthy();
        expect(label.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('createAgentInstructions', () => {
    it('should create a Map from partial content', () => {
      const content: Partial<Record<ScrumRole, string>> = {
        product_owner: '# Product Owner Instructions',
        developer: '# Developer Instructions',
      };

      const instructions = createAgentInstructions(content);

      expect(instructions.size).toBe(2);
      expect(instructions.get('product_owner')).toBe('# Product Owner Instructions');
      expect(instructions.get('developer')).toBe('# Developer Instructions');
      expect(instructions.get('scrum_master')).toBeUndefined();
    });

    it('should handle empty content', () => {
      const instructions = createAgentInstructions({});
      expect(instructions.size).toBe(0);
    });

    it('should skip undefined values', () => {
      const content: Partial<Record<ScrumRole, string>> = {
        product_owner: '# PO',
        developer: undefined,
      };

      const instructions = createAgentInstructions(content);
      expect(instructions.size).toBe(1);
    });
  });

  describe('createOnboardingLogger', () => {
    it('should create a logger with standard methods', () => {
      const logger = createOnboardingLogger();

      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should not throw when logging', () => {
      const logger = createOnboardingLogger();

      expect(() => logger.debug('test debug')).not.toThrow();
      expect(() => logger.info('test info')).not.toThrow();
      expect(() => logger.warn('test warn')).not.toThrow();
      expect(() => logger.error('test error')).not.toThrow();
    });
  });

  describe('Agent Creation Order', () => {
    it('should have agents ordered by dependency', () => {
      // First 4 should have no internal dependencies (report to CEO)
      const noDeps = SCRUM_AGENTS.slice(0, 4);
      for (const agent of noDeps) {
        expect(agent.reportsToRole).toBeNull();
      }

      // Last 2 should report to technical_lead
      const withDeps = SCRUM_AGENTS.slice(4);
      for (const agent of withDeps) {
        expect(agent.reportsToRole).toBe('technical_lead');
      }
    });

    it('should have technical_lead defined before developers', () => {
      const tlIndex = SCRUM_AGENTS.findIndex((a) => a.role === 'technical_lead');
      const dev1Index = SCRUM_AGENTS.findIndex((a) => a.role === 'developer');
      const dev2Index = SCRUM_AGENTS.findIndex((a) => a.role === 'developer_2');

      expect(tlIndex).toBeLessThan(dev1Index);
      expect(tlIndex).toBeLessThan(dev2Index);
    });
  });
});
