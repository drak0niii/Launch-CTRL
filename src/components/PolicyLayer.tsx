import { useState, forwardRef } from "react";
import { Shield, AlertCircle, Target, Settings } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export interface PolicyLayerProps {}

export const PolicyLayer = forwardRef<HTMLDivElement, PolicyLayerProps>((_props, ref) => {
  const [alarmPriority, setAlarmPriority] = useState("Critical First");
  const [waysOfWorking, setWaysOfWorking] = useState("Human-in-the-Loop");
  const [kpiAlignment, setKpiAlignment] = useState("Strict Compliance >95%");

  const parameters = [
    {
      icon: AlertCircle,
      label: "Alarm Prioritization",
      value: alarmPriority,
      options: ["Critical First", "Adaptive Correlation"],
      onChange: (v: string) => setAlarmPriority(v),
      placeholder: "Select priority",
    },
    {
      icon: Settings,
      label: "Ways of Working",
      value: waysOfWorking,
      options: ["Human-in-the-Loop", "E2E Automation"],
      onChange: (v: string) => setWaysOfWorking(v),
      placeholder: "Select mode",
    },
    {
      icon: Target,
      label: "KPI Alignment",
      value: kpiAlignment,
      options: ["Strict Compliance >95%", "Flexible Performance >75%"],
      onChange: (v: string) => setKpiAlignment(v),
      placeholder: "Select KPI policy",
    },
  ] as const;

  return (
    <div ref={ref} className="relative select-none">
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-blue-900 rounded-2xl p-4 sm:p-6 border border-purple-500/30 shadow-2xl shadow-purple-500/20">
        {/* Header */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
          <div className="p-1.5 sm:p-2 bg-purple-500/20 rounded-lg border border-purple-400/30">
            <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-purple-300" />
          </div>
          <h2 className="text-white text-lg sm:text-xl md:text-2xl tracking-wide text-center">
            Policy &amp; Governance
          </h2>
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
          {parameters.map((param, idx) => {
            const Icon = param.icon;
            return (
              <div
                key={idx}
                className="bg-black/30 backdrop-blur-sm rounded-lg p-3 sm:p-4 border border-purple-400/20 hover:border-purple-400/40 transition-all flex flex-col items-center text-center"
              >
                <div className="flex items-center justify-center gap-2 mb-2 sm:mb-3">
                  <Icon className="w-4 h-4 text-purple-300 flex-shrink-0" />
                  <span className="text-purple-200 text-xs sm:text-sm leading-tight">
                    {param.label}
                  </span>
                </div>

                <Select value={param.value} onValueChange={param.onChange}>
                  <SelectTrigger
                    aria-label={param.placeholder}
                    className="w-full min-h-9 bg-black/50 border-purple-400/30 text-white hover:border-purple-400/50 focus:border-purple-400 focus:ring-purple-400/30 text-xs sm:text-sm whitespace-nowrap"
                  >
                    <SelectValue placeholder={param.placeholder} />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-purple-400/30">
                    {param.options.map((option) => (
                      <SelectItem
                        key={option}
                        value={option}
                        className="text-white hover:bg-purple-500/20 focus:bg-purple-500/30 text-xs sm:text-sm cursor-pointer"
                      >
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connection point (bottom center) — pointer-events-none so it never blocks drag */}
      <div
        data-connection-point="bottom"
        className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-purple-500 rounded-full border-2 border-purple-300 shadow-lg shadow-purple-500/50 z-10"
      />
    </div>
  );
});

PolicyLayer.displayName = "PolicyLayer";
