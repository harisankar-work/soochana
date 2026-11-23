import { ArrowRight, ArrowUpRight, Compass, Inbox, MessageCircle, MessagesSquare, Target, Upload } from "lucide-react";
import Link from "next/link";
import { DashboardData } from "@/features/analytics/dashboard";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

const metrics = [
  { label: "Total Feedback", icon: MessagesSquare },
  { label: "Sentiment Breakdown", icon: MessageCircle },
  { label: "Identified Issues", icon: Compass },
  { label: "Priority Issues", icon: Target },
];

const workflow = [
  { label: "Upload Feedback", icon: Upload },
  { label: "Analyse Sentiment", icon: MessageCircle },
  { label: "Discover Issues", icon: Compass },
  { label: "Prioritize Actions", icon: Target },
];

export default function Dashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="An overview of your customer feedback and product issues." />
      <DashboardData empty={<>
      <section className="hero" aria-labelledby="dashboard-intro">
        <div className="hero-content">
          <h2 id="dashboard-intro">Understand your customers. Prioritize what matters.</h2>
          <p>Start with synthetic shop reviews or import your own CSV. Trace patterns back to individual reviews before deciding what to investigate.</p>
          <div className="hero-actions">
            <Link href="/feedback#start-import" className="primary-link">
              Try Demo Dataset <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
            <Link href="/feedback" className="hero-upload">Upload Feedback</Link>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true" />
      </section>

      <section className="section" aria-labelledby="overview">
        <h2 id="overview">Feedback overview</h2>
        <ul className="metric-grid">
          {metrics.map(({ label, icon: Icon }) => (
            <li className="panel metric" key={label}>
              <span className="icon-tile"><Icon aria-hidden="true" size={18} /></span>
              <h3>{label}</h3>
              <p>No data yet</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="section panel workflow" aria-labelledby="workflow">
        <h2 id="workflow">Feedback workflow</h2>
        <p>Import feedback, analyse sentiment, discover themes, and prioritize investigations.</p>
        <ol className="workflow-list">
          {workflow.map(({ label, icon: Icon }, index) => (
            <li key={label}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
              {index < workflow.length - 1 && <ArrowRight className="step-arrow" aria-hidden="true" size={15} />}
            </li>
          ))}
        </ol>
      </section>

      <div className="section">
        <EmptyState icon={Inbox} title="No feedback to analyse yet">
          <p>Import a CSV of reviews or support tickets to preview your feedback.</p>
        </EmptyState>
      </div>
      </>} />
    </>
  );
}
