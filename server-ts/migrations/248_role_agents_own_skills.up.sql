-- Berry migration 248: every role agent carries exactly its own eight skills.
--
-- Every catalogue role now has eight pack skills labelled with its name
-- (seed/data/berry-software-skills and seed/data/berry-work-skills). Two older
-- seeding paths bound more than that, and this removes what they left:
--
--   * core roles were also bound to every pack skill of the specialists they
--     stand in for (ADR-0018): up to 28 on the Software Engineer;
--   * role agents with no pack skills got one-line capability skills
--     (source seed://role-capability).
--
-- Removed: a role agent's bindings to capability skills, and to any other
-- seeded skill (source_url 'seed://...') not labelled with that role. Skills stay
-- in the library, and a binding to a skill a person made or imported is left
-- alone. The role is matched by role_key, so a renamed role agent keeps its
-- own skills. The next boot binds each role agent to its eight.

WITH catalog (role_key, role_name) AS (
   VALUES
   ('orchestrator', 'Orchestrator'),
   ('planner', 'Planner'),
   ('product-lead', 'Product Lead'),
   ('business-analyst', 'Business Analyst'),
   ('ux-researcher', 'UX Researcher'),
   ('product-designer', 'Product Designer'),
   ('software-engineer', 'Software Engineer'),
   ('software-architect', 'Software Architect'),
   ('backend-engineer', 'Backend Engineer'),
   ('frontend-engineer', 'Frontend Engineer'),
   ('database-engineer', 'Database Engineer'),
   ('integration-engineer', 'Integration Engineer'),
   ('qa-engineer', 'QA Engineer'),
   ('reviewer', 'Reviewer'),
   ('security-engineer', 'Security Engineer'),
   ('devops-engineer', 'DevOps Engineer'),
   ('sre', 'Site Reliability Engineer'),
   ('data-analytics-engineer', 'Data & Analytics Engineer'),
   ('technical-writer', 'Technical Writer'),
   ('growth-engineer', 'Growth Engineer'),
   ('engineering-manager', 'Engineering Manager'),
   ('cto', 'CTO'),
   ('marketing-strategist', 'Marketing Strategist'),
   ('content-writer', 'Content Writer'),
   ('social-media-manager', 'Social Media Manager'),
   ('sales-specialist', 'Sales Specialist'),
   ('customer-support-specialist', 'Customer Support Specialist'),
   ('recruiter', 'Recruiter'),
   ('people-partner', 'People Partner'),
   ('financial-analyst', 'Financial Analyst'),
   ('legal-assistant', 'Legal Assistant'),
   ('research-analyst', 'Research Analyst'),
   ('editor', 'Editor'),
   ('translator', 'Translator'),
   ('learning-designer', 'Learning Designer'),
   ('operations-coordinator', 'Operations Coordinator'),
   ('executive-assistant', 'Executive Assistant'),
   ('project-manager', 'Project Manager'),
   ('procurement-specialist', 'Procurement Specialist'),
   ('event-planner', 'Event Planner'),
   ('process-analyst', 'Process Improvement Analyst'),
   ('supply-chain-coordinator', 'Supply Chain Coordinator'),
   ('ux-writer', 'UX Writer'),
   ('accessibility-specialist', 'Accessibility Specialist'),
   ('product-operations-manager', 'Product Operations Manager'),
   ('mobile-engineer', 'Mobile Engineer'),
   ('test-automation-engineer', 'Test Automation Engineer'),
   ('performance-engineer', 'Performance Engineer'),
   ('privacy-specialist', 'Privacy Specialist'),
   ('risk-analyst', 'Risk Analyst'),
   ('quality-manager', 'Quality Manager'),
   ('cloud-engineer', 'Cloud Engineer'),
   ('platform-engineer', 'Platform Engineer'),
   ('release-manager', 'Release Manager'),
   ('it-support-specialist', 'IT Support Specialist'),
   ('systems-administrator', 'Systems Administrator'),
   ('finops-analyst', 'FinOps Analyst'),
   ('data-scientist', 'Data Scientist'),
   ('bi-analyst', 'BI Analyst'),
   ('seo-specialist', 'SEO Specialist'),
   ('customer-insights-analyst', 'Customer Insights Analyst'),
   ('pricing-analyst', 'Pricing Analyst'),
   ('chief-of-staff', 'Chief of Staff'),
   ('coo', 'COO'),
   ('cfo', 'CFO'),
   ('cmo', 'CMO'),
   ('chief-people-officer', 'Chief People Officer'),
   ('strategy-director', 'Strategy Director'),
   ('sustainability-lead', 'Sustainability Lead'),
   ('brand-manager', 'Brand Manager'),
   ('email-marketing-specialist', 'Email Marketing Specialist'),
   ('pr-specialist', 'PR Specialist'),
   ('video-producer', 'Video Producer'),
   ('product-marketing-manager', 'Product Marketing Manager'),
   ('account-manager', 'Account Manager'),
   ('customer-success-manager', 'Customer Success Manager'),
   ('bid-manager', 'Bid Manager'),
   ('partnership-manager', 'Partnership Manager'),
   ('onboarding-specialist', 'Customer Onboarding Specialist'),
   ('sales-operations-analyst', 'Sales Operations Analyst'),
   ('talent-sourcer', 'Talent Sourcer'),
   ('compensation-analyst', 'Compensation Analyst'),
   ('employee-experience-specialist', 'Employee Experience Specialist'),
   ('workforce-planner', 'Workforce Planner'),
   ('internal-communications-specialist', 'Internal Communications Specialist'),
   ('health-safety-advisor', 'Health & Safety Advisor'),
   ('bookkeeper', 'Bookkeeper'),
   ('payroll-specialist', 'Payroll Specialist'),
   ('tax-assistant', 'Tax Assistant'),
   ('contract-manager', 'Contract Manager'),
   ('compliance-officer', 'Compliance Officer'),
   ('internal-auditor', 'Internal Auditor'),
   ('knowledge-manager', 'Knowledge Manager'),
   ('grant-writer', 'Grant Writer'),
   ('policy-analyst', 'Policy Analyst'),
   ('tutor', 'Tutor')
)
DELETE FROM agent_skills AS binding
 USING agents AS agent, skills AS skill, catalog
 WHERE binding.agent_id = agent.id
   AND binding.skill_id = skill.id
   AND agent.role_key = catalog.role_key
   AND (
      skill.source_url = 'seed://role-capability'
      OR (skill.source_url LIKE 'seed://%' AND NOT (catalog.role_name = ANY (skill.labels)))
   );
