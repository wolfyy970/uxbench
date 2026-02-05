package schema

import "time"

// BenchmarkReport matches the JSON schema structure
type BenchmarkReport struct {
	SchemaVersion string          `json:"schema_version"`
	Source        string          `json:"source"`
	Metadata      BenchmarkMetadata `json:"metadata"`
	Metrics       BenchmarkMetrics  `json:"metrics"`
	HumanSignals  *HumanSignals     `json:"human_signals,omitempty"`
	ActionLog     []ActionLogEntry  `json:"action_log,omitempty"`
}

type BenchmarkMetadata struct {
	RecordingName   string    `json:"recording_name"`
	Product         string    `json:"product"`
	Task            string    `json:"task"`
	URL             string    `json:"url"`
	URLsVisited     []string  `json:"urls_visited"`
	Timestamp       time.Time `json:"timestamp"`
	DurationMS      int       `json:"duration_ms"`
	Browser         string    `json:"browser"`
	SourceVersion   string    `json:"source_version"`
	Operator        string    `json:"operator"`
	Persona         *string   `json:"persona,omitempty"`
	AgentModel      *string   `json:"agent_model,omitempty"`
	NavigationCount int       `json:"navigation_count"`
	NavigationGapMS int       `json:"navigation_gap_ms"`
}

type BenchmarkMetrics struct {
	ClickCount       ClickCount       `json:"click_count"`
	TimeOnTask       TimeOnTask       `json:"time_on_task"`
	Fitts            Fitts            `json:"fitts"`
	InformationDensity InformationDensity `json:"information_density"`
	ContextSwitches  ContextSwitches  `json:"context_switches"`
	ShortcutCoverage ShortcutCoverage `json:"shortcut_coverage"`
	TypingRatio      TypingRatio      `json:"typing_ratio"`
	NavigationDepth  NavigationDepth  `json:"navigation_depth"`
	ScanningDistance ScanningDistance `json:"scanning_distance"`
	ScrollDistance   ScrollDistance   `json:"scroll_distance"`
	CompositeScore   float64          `json:"composite_score"`
}

type ClickCount struct {
	Total             int                  `json:"total"`
	Productive        int                  `json:"productive"`
	Ceremonial        int                  `json:"ceremonial"`
	Wasted            int                  `json:"wasted"`
	CeremonialDetails []ClickContextDetail `json:"ceremonial_details"`
	WastedDetails     []ClickContextDetail `json:"wasted_details"`
}

type ClickContextDetail struct {
	Element string `json:"element"`
	Reason  string `json:"reason"`
}

type TimeOnTask struct {
	TotalMS           int           `json:"total_ms"`
	ActiveMS          *int          `json:"active_ms"`
	IdleMS            *int          `json:"idle_ms"`
	ApplicationWaitMS int           `json:"application_wait_ms"`
	LongestIdleMS     *int          `json:"longest_idle_ms"`
	LongestIdleAfter  *string       `json:"longest_idle_after"`
	LongestWaitMS     *int          `json:"longest_wait_ms"`
	LongestWaitTrigger *string      `json:"longest_wait_trigger"`
	ConfusionGaps     []ConfusionGap `json:"confusion_gaps"`
}

type ConfusionGap struct {
	GapMS        float64 `json:"gap_ms"`
	AfterAction  string  `json:"after_action"`
	BeforeAction string  `json:"before_action"`
}

type Fitts struct {
	Formula             string        `json:"formula"`
	CumulativeID        float64       `json:"cumulative_id"`
	AverageID           float64       `json:"average_id"`
	MaxID               float64       `json:"max_id"`
	MaxIDElement        string        `json:"max_id_element"`
	MaxIDDistancePx     float64       `json:"max_id_distance_px"`
	MaxIDTargetSize     string        `json:"max_id_target_size"`
	Top3Hardest         []FittsTarget `json:"top_3_hardest"`
	Throughput          *FittsThroughput `json:"throughput"`
	AveragePathEfficiency *float64    `json:"average_path_efficiency"`
	TotalOvershoots     *int          `json:"total_overshoots"`
}

type FittsTarget struct {
	Element    string  `json:"element"`
	ID         float64 `json:"id"`
	DistancePx float64 `json:"distance_px"`
	TargetSize string  `json:"target_size"`
}

type FittsThroughput struct {
	AMS         float64 `json:"a_ms"`
	BMsPerBit   float64 `json:"b_ms_per_bit"`
	RSquared    float64 `json:"r_squared"`
}

type InformationDensity struct {
	Method            string  `json:"method"`
	AverageContentRatio float64 `json:"average_content_ratio"`
	MinContentRatio   float64 `json:"min_content_ratio"`
	MaxContentRatio   float64 `json:"max_content_ratio"`
	MinContentContext *string `json:"min_content_context"`
	MaxContentContext *string `json:"max_content_context"`
}

type ContextSwitches struct {
	Total                 int     `json:"total"`
	Ratio                 float64 `json:"ratio"`
	LongestKeyboardStreak *int    `json:"longest_keyboard_streak"`
	LongestMouseStreak    *int    `json:"longest_mouse_streak"`
	MostSwitchHeavyMoment *string `json:"most_switch_heavy_moment"`
}

type ShortcutCoverage struct {
	ShortcutsUsed      int                  `json:"shortcuts_used"`
	MouseWithShortcut  int                  `json:"mouse_with_shortcut"`
	Ratio              float64              `json:"ratio"`
	AccesskeysFound    *int                 `json:"accesskeys_found"`
	MissedShortcuts    []MissedShortcut     `json:"missed_shortcuts"`
}

type MissedShortcut struct {
	Action   string `json:"action"`
	Shortcut string `json:"shortcut"`
}

type TypingRatio struct {
	FreeTextInputs    int      `json:"free_text_inputs"`
	ConstrainedInputs int      `json:"constrained_inputs"`
	Ratio             float64  `json:"ratio"`
	FreeTextFields    []string `json:"free_text_fields"`
}

type NavigationDepth struct {
	MaxDepth          int           `json:"max_depth"`
	TotalDepthChanges int           `json:"total_depth_changes"`
	DeepestMoment     *string       `json:"deepest_moment"`
	DepthPath         []DepthChange `json:"depth_path"`
}

type DepthChange struct {
	Direction string `json:"direction"`
	Layer     string `json:"layer"`
}

type ScanningDistance struct {
	Method          string  `json:"method"`
	CumulativePx    float64 `json:"cumulative_px"`
	AveragePx       float64 `json:"average_px"`
	MaxSinglePx     float64 `json:"max_single_px"`
	MaxSingleFrom   *string `json:"max_single_from"`
	MaxSingleTo     *string `json:"max_single_to"`
}

type ScrollDistance struct {
	TotalPx           float64 `json:"total_px"`
	PageScrollPx      *float64 `json:"page_scroll_px"`
	ContainerScrollPx *float64 `json:"container_scroll_px"`
	ScrollEvents      *int     `json:"scroll_events"`
	HeaviestContainer *string  `json:"heaviest_container"`
}

type HumanSignals struct {
	DecisionTime    DecisionTime    `json:"decision_time"`
	Hesitation      Hesitation      `json:"hesitation"`
	ThroughputIndex ThroughputIndex `json:"throughput_index"`
}

type DecisionTime struct {
	MeanMS        float64          `json:"mean_ms"`
	MedianMS      float64          `json:"median_ms"`
	P90MS         float64          `json:"p90_ms"`
	ConfusionGaps int              `json:"confusion_gaps"`
	WorstConfusion *ConfusionDetail `json:"worst_confusion"`
}

type ConfusionDetail struct {
	GapMS       float64 `json:"gap_ms"`
	AfterAction string  `json:"after_action"`
	LikelyCause string  `json:"likely_cause"`
}

type Hesitation struct {
	HoverHesitations    int `json:"hover_hesitations"`
	NearMissCorrections int `json:"near_miss_corrections"`
	RepeatedTargeting   int `json:"repeated_targeting"`
}

type ThroughputIndex struct {
	BCoefficientMsPerBit float64 `json:"b_coefficient_ms_per_bit"`
	ComparisonToNorm     string  `json:"comparison_to_norm"`
}

type ActionLogEntry map[string]interface{}
