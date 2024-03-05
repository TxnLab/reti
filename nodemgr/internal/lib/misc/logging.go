package misc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"runtime"
	"time"
)

func Errorf(logger *slog.Logger, format string, args ...any) {
	helperf(logger, slog.LevelError, format, args...)
}

func Warnf(logger *slog.Logger, format string, args ...any) {
	helperf(logger, slog.LevelWarn, format, args...)
}

func Infof(logger *slog.Logger, format string, args ...any) {
	helperf(logger, slog.LevelInfo, format, args...)
}

func Debugf(logger *slog.Logger, format string, args ...any) {
	helperf(logger, slog.LevelDebug, format, args...)
}

func helperf(logger *slog.Logger, level slog.Level, format string, args ...any) {
	if !logger.Enabled(context.Background(), level) {
		return
	}
	var pcs [1]uintptr
	runtime.Callers(3, pcs[:]) // skip [Callers, helperf, [info/warn/debug]f]
	r := slog.NewRecord(time.Now(), level, fmt.Sprintf(format, args...), pcs[0])
	_ = logger.Handler().Handle(context.Background(), r)
}

type MinimalHandlerOptions struct {
	SlogOpts slog.HandlerOptions
}

type MinimalHandler struct {
	slog.Handler
	l *log.Logger
}

func (h *MinimalHandler) Handle(ctx context.Context, r slog.Record) error {
	var (
		extra string
	)
	if r.NumAttrs() > 0 {
		fields := make(map[string]any, r.NumAttrs())
		r.Attrs(func(a slog.Attr) bool {
			fields[a.Key] = fmt.Sprintf("%v", a.Value.Any())

			return true
		})

		//extra = fmt.Sprintf("%s", fields)
		b, err := json.Marshal(fields)
		if err != nil {
			return err
		}
		extra = string(b)
	}

	h.l.Println(r.Message, string(extra))

	return nil
}

func NewMinimalHandler(out io.Writer, opts MinimalHandlerOptions) *MinimalHandler {
	//h := &MinimalHandler{
	//	Handler: slog.Default().Handler(),
	//	l:       log.New(out, "", 0),
	//}
	//h.Handler.
	opts.SlogOpts.ReplaceAttr = func(groups []string, a slog.Attr) slog.Attr {
		//if a.Key == slog.TimeKey && len(groups) == 0 {
		//	return slog.Attr{}
		//} else if a.Key == slog.LevelKey && len(groups) == 0 {
		//	return slog.Attr{}
		//}
		return a
	}
	h := &MinimalHandler{
		Handler: slog.NewJSONHandler(out, &opts.SlogOpts),
		l:       log.New(out, "", 0),
	}

	return h
}
