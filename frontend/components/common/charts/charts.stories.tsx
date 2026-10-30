import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import {
   ChartPanel,
   Donut,
   Gauge,
   Lollipops,
   PairedBars,
   RangeStrip,
   SeriesBars,
   ShareStrip,
   Squares,
   Treemap,
} from './charts';

/**
 * The Usage page's chart primitives. Each is pure markup driven by its props,
 * so a story needs no store or network mocking — only real numbers, per the
 * design system's rule against invented series. `ChartPanel` is the shared
 * wrapper every chart sits in, so it is the file's `component`; each other
 * shape is storied through `render`.
 */
const meta = {
   component: ChartPanel,
   tags: ['ai-generated'],
   args: { title: 'Who spent it', hint: '6 agents ran' },
} satisfies Meta<typeof ChartPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A time series with a second measure hanging below the line. */
export const TimeSeriesWithSecondMeasure: Story = {
   args: { title: 'Spend', hint: 'last 7 days' },
   render: (args) => (
      <ChartPanel {...args}>
         <SeriesBars
            label="Dollars spent each day above the line, runs started each day below it."
            bars={[
               { key: 'mon', label: 'Mon', top: 42, topLabel: '$42', bottom: 6, bottomLabel: '6' },
               { key: 'tue', label: 'Tue', top: 58, topLabel: '$58', bottom: 9, bottomLabel: '9' },
               { key: 'wed', label: 'Wed', top: 31, topLabel: '$31', bottom: 4, bottomLabel: '4' },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('img', {
            name: 'Dollars spent each day above the line, runs started each day below it.',
         })
      ).toBeVisible();
   },
};

/** Who took which share, as areas sized by value, largest at the top left. */
export const SharesAsAreas: Story = {
   render: (args) => (
      <ChartPanel {...args}>
         <Treemap
            label="Spend by agent, as areas. The largest is at the top left."
            items={[
               { id: 'frontend', label: 'Frontend Engineer', value: 420, figure: '$4.20' },
               { id: 'backend', label: 'Backend Engineer', value: 180, figure: '$1.80' },
               { id: 'qa', label: 'QA Engineer', value: 60, figure: '$0.60' },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Frontend Engineer')).toBeVisible();
      await expect(canvas.getByText('$4.20')).toBeVisible();
   },
};

/** Shares of a whole, five or fewer, as a ring with the largest named in the middle. */
export const SharesOfAWhole: Story = {
   args: { title: 'Which model' },
   render: (args) => (
      <ChartPanel {...args}>
         <Donut
            label="Spend by model, as shares of a ring."
            center="64%"
            centerLabel="Claude Sonnet 5"
            slices={[
               { label: 'Claude Sonnet 5', value: 64, figure: '$6.40', color: 'var(--foreground)' },
               { label: 'Claude Haiku 4.5', value: 36, figure: '$3.60', color: 'var(--chart-2)' },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('64%')).toBeVisible();
      await expect(canvas.getAllByText('Claude Sonnet 5').length).toBeGreaterThan(0);
   },
};

/** One ratio, as a three-quarter dial. */
export const OneRatio: Story = {
   args: { title: 'Prompt cache' },
   render: (args) => (
      <ChartPanel {...args}>
         <Gauge
            ratio={0.42}
            label="42.0 percent of prompt tokens were read from cache."
            figure="42.0%"
            caption="read from cache"
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('42.0%')).toBeVisible();
   },
};

/** One value per row against a reference, such as the workspace average. */
export const ValuesAgainstAReference: Story = {
   args: { title: 'What a finished task costs', hint: 'by agent' },
   render: (args) => (
      <ChartPanel {...args}>
         <Lollipops
            label="Dollars per finished task, by agent, against the workspace average."
            reference={2.4}
            rows={[
               { id: 'frontend', label: 'Frontend Engineer', value: 1.8, figure: '$1.80' },
               { id: 'backend', label: 'Backend Engineer', value: 3.1, figure: '$3.10' },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('img', {
            name: 'Dollars per finished task, by agent, against the workspace average.',
         })
      ).toBeVisible();
      await expect(canvas.getByText('$3.10')).toBeVisible();
   },
};

/** Two measures side by side, one row per subject, each column on its own scale. */
export const TwoMeasuresSideBySide: Story = {
   args: { title: 'Runs and cost per run', hint: 'by agent' },
   render: (args) => (
      <ChartPanel {...args}>
         <PairedBars
            label="Each agent by how many runs it made and what a run of it cost."
            headings={['Runs', 'Per run']}
            rows={[
               {
                  id: 'frontend',
                  label: 'Frontend Engineer',
                  left: 12,
                  right: 1.4,
                  leftFigure: '12',
                  rightFigure: '$1.40',
               },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('12')).toBeVisible();
      await expect(canvas.getByText('$1.40')).toBeVisible();
   },
};

/** Where the middle and the bulk of a spread sit between its two ends. */
export const SpreadBetweenTwoEnds: Story = {
   args: { title: 'How long a task takes', hint: 'from created to done' },
   render: (args) => (
      <ChartPanel {...args}>
         <RangeStrip
            min={30}
            median={420}
            p90={1_800}
            max={3_600}
            format={(seconds) => `${Math.round(seconds / 60)} min`}
            label="Half of tasks are done within 7 min, nine in ten within 30 min."
            captions={{
               min: 'fastest',
               median: 'half are done',
               p90: 'nine in ten',
               max: 'slowest',
            }}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('7 min')).toBeVisible();
      await expect(canvas.getByText('fastest')).toBeVisible();
   },
};

/** A small count, as that many squares, so it stays countable. */
export const SmallCountAsSquares: Story = {
   args: { title: 'Who finished them', hint: 'one square = one task done' },
   render: (args) => (
      <ChartPanel {...args}>
         <Squares count={6} />
      </ChartPanel>
   ),
   play: async ({ canvasElement }) => {
      const wrapper = canvasElement.querySelector('[aria-hidden="true"]');
      await expect(wrapper?.children).toHaveLength(6);
   },
};

/** Shares of one total, as a single strip of blocks, largest first. */
export const SharesInALine: Story = {
   args: { title: 'Where the agent hours went', hint: 'run time, by agent' },
   render: (args) => (
      <ChartPanel {...args}>
         <ShareStrip
            label="Run time by agent, as shares of one strip."
            shares={[
               { id: 'frontend', label: 'Frontend Engineer', value: 300, figure: '5 h' },
               { id: 'backend', label: 'Backend Engineer', value: 120, figure: '2 h' },
            ]}
         />
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('5 h')).toBeVisible();
   },
};

/**
 * Nothing to show: per the design system, the panel says so in a sentence
 * rather than drawing an empty frame.
 */
export const NothingToShow: Story = {
   args: { title: 'Which model' },
   render: (args) => (
      <ChartPanel {...args}>
         <p className="text-muted-foreground">No priced model calls in this window.</p>
      </ChartPanel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('No priced model calls in this window.')).toBeVisible();
      await expect(canvas.queryByRole('img')).toBeNull();
   },
};
