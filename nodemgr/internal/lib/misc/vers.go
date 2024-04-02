package misc

import (
	"runtime/debug"
	"slices"
)

const version = "v0.0.1"

func GetVersionInfo() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "The version information could not be determined"
	}
	var vcsRev = "(unknown)"
	if fnd := slices.IndexFunc(info.Settings, func(v debug.BuildSetting) bool { return v.Key == "vcs.revision" }); fnd != -1 {
		vcsRev = info.Settings[fnd].Value[0:7]
	}
	return vcsRev
}
