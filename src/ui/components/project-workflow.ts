import type { ProjectOnboarding } from '../../core/types';

export interface ProjectWorkflowProgress {
  unrefinedTasks: number;
}

export interface ProjectWorkflowActivity {
  phase:
    | 'project_request'
    | 'technical_analysis'
    | 'technical_analysis_approval'
    | 'product_backlog'
    | 'technical_refinement'
    | 'sprint_approval'
    | 'delivery'
    | 'completed';
  actor: string;
  title: string;
  detail: string;
  nextStep: string;
  attentionRequired: boolean;
  ticketLinkLabel: string;
}

export function describeProjectWorkflow(
  onboarding: Pick<ProjectOnboarding, 'status'>,
  progress: ProjectWorkflowProgress
): ProjectWorkflowActivity {
  switch (onboarding.status) {
    case 'analysis_in_progress':
      return {
        phase: 'technical_analysis',
        actor: 'Technical Lead',
        title: 'Technical analysis is in progress',
        detail: 'The Technical Lead is inspecting the project and documenting the delivery approach in Paperclip.',
        nextStep: 'Wait for the completed analysis.',
        attentionRequired: false,
        ticketLinkLabel: 'Open technical analysis',
      };
    case 'analysis_ready':
      return {
        phase: 'technical_analysis_approval',
        actor: 'You',
        title: 'Technical analysis needs your approval',
        detail: 'The Technical Lead has completed the analysis and is waiting for a product decision.',
        nextStep: 'Approve the analysis or request concrete changes.',
        attentionRequired: true,
        ticketLinkLabel: 'Open approval',
      };
    case 'backlog_in_progress':
      return {
        phase: 'product_backlog',
        actor: 'Product Owner',
        title: 'Product Owner is writing the first stories',
        detail: 'The Product Owner is turning the approved analysis into an ordered Paperclip backlog.',
        nextStep: 'Review and approve the backlog when it is ready.',
        attentionRequired: false,
        ticketLinkLabel: 'Open Product Owner backlog',
      };
    case 'sprint_planning':
      if (progress.unrefinedTasks > 0) {
        return {
          phase: 'technical_refinement',
          actor: 'Technical Lead',
          title: 'Technical Lead is refining backlog stories',
          detail: `${progress.unrefinedTasks} backlog ${progress.unrefinedTasks === 1 ? 'story needs' : 'stories need'} estimates and acceptance criteria before the sprint can start.`,
          nextStep: 'Wait for refinement to finish.',
          attentionRequired: false,
          ticketLinkLabel: 'Open technical refinement',
        };
      }
      return {
        phase: 'sprint_approval',
        actor: 'You',
        title: 'Sprint is ready for your approval',
        detail: 'The Product Owner backlog and Technical Lead refinement are complete.',
        nextStep: 'Start the first sprint.',
        attentionRequired: true,
        ticketLinkLabel: 'Open sprint planning',
      };
    case 'active':
      return {
        phase: 'delivery',
        actor: 'Delivery team',
        title: 'Delivery is running on this board',
        detail: 'Development, review, and QA progress are tracked in the Kanban below.',
        nextStep: 'No outside-board approval is currently required.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project kickoff',
      };
    case 'completed':
      return {
        phase: 'completed',
        actor: 'Delivery team',
        title: 'Project workflow is complete',
        detail: 'Sprint review and retrospective have been recorded.',
        nextStep: 'Plan the next feature when you are ready.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project summary',
      };
    default:
      return {
        phase: 'project_request',
        actor: 'You',
        title: 'No external project work is running',
        detail: 'Start a project request to begin the Technical Lead analysis.',
        nextStep: 'Choose a project and describe the requested outcome.',
        attentionRequired: false,
        ticketLinkLabel: 'Open project request',
      };
  }
}