import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { DeviceProvider } from './app/DeviceContext';
import { ToastProvider } from './components/Toast';
import { ClinicianShell } from './features/clinician/ClinicianShell';
import { PatientRecordPage } from './features/clinician/PatientRecordPage';
import { ReviewsPage } from './features/clinician/ReviewsPage';
import { RulesPage } from './features/clinician/RulesPage';
import { DemoPage } from './features/demo/DemoPage';
import { WorklistPage } from './features/clinician/WorklistPage';
import { AssistScreen } from './features/patient/AssistScreen';
import { CheckInScreen } from './features/patient/CheckInScreen';
import { DeviceScreen } from './features/patient/DeviceScreen';
import { OnboardingScreen } from './features/patient/OnboardingScreen';
import { PatientFrame, PatientTabs } from './features/patient/PatientShell';
import { ProgressScreen } from './features/patient/ProgressScreen';
import { TestScreen } from './features/patient/TestScreen';
import { TodayScreen } from './features/patient/TodayScreen';

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
      <div>
        <h1 className="display text-[28px] leading-9 text-ink">That page isn’t part of the prototype.</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-soft">Start from the demo controls to open the patient app or the clinician portal.</p>
        <Link to="/demo" className="btn-primary mt-5 inline-flex min-h-12 items-center rounded-[12px] px-5 text-[15px] font-semibold text-white shadow-button">
          Open demo controls
        </Link>
      </div>
    </main>
  );
}

export function App() {
  return (
    <DeviceProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/demo" replace />} />
          <Route path="/demo" element={<DemoPage />} />

          <Route element={<PatientFrame />}>
            <Route path="/onboarding" element={<OnboardingScreen />} />
            <Route path="/patient" element={<PatientTabs />}>
              <Route index element={<TodayScreen />} />
              <Route path="assist" element={<AssistScreen />} />
              <Route path="test" element={<TestScreen />} />
              <Route path="check-in" element={<CheckInScreen />} />
              <Route path="progress" element={<ProgressScreen />} />
              <Route path="device" element={<DeviceScreen />} />
            </Route>
          </Route>

          <Route path="/clinician" element={<ClinicianShell />}>
            <Route index element={<WorklistPage />} />
            <Route path="patients/:id" element={<PatientRecordPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="rules" element={<RulesPage />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </DeviceProvider>
  );
}
