package misc

import (
	"runtime/debug"
	"slices"
)

// Variables set at build time using govv flags (https://github.com/ahmetb/govvv)
//var (
//	GitSummary     string // This will contain xxxx-dirty in many cases because of things removed from docker build
//	GitCommit      string // .. so we'll just use the commit.
//	GitBranch      string
//	BuildDate      string
//	VersionSummary = fmt.Sprintf("%s:%s [%s]", GitCommit, GitBranch, BuildDate)
//)

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
