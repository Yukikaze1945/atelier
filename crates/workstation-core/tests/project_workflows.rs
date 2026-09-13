use serde_json::{json, Value};
use tempfile::TempDir;
use workstation_core::{model::ProjectView, Engine};

struct Fixture {
    dir: TempDir,
    engine: Engine,
    project: ProjectView,
}
impl Fixture {
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let engine = Engine::new(&dir.path().join("state")).unwrap();
        let project = serde_json::from_value(
            engine
                .call(
                    "project.create",
                    json!({"name":"测试 项目","parentDirectory":dir.path()}),
                )
                .unwrap(),
        )
        .unwrap();
        Self {
            dir,
            engine,
            project,
        }
    }
    fn edit(&mut self, command: Value) {
        self.project=serde_json::from_value(self.engine.call("project.command",json!({"projectId":self.project.project.id,"expectedRevision":self.project.project.revision,"command":command})).unwrap()).unwrap();
    }
    fn history(&mut self, redo: bool) {
        self.project=serde_json::from_value(self.engine.call(if redo {"project.redo"}else{"project.undo"},json!({"projectId":self.project.project.id,"expectedRevision":self.project.project.revision})).unwrap()).unwrap();
    }
    fn import(&mut self, mode: &str) {
        let file = self.dir.path().join("镜头 source.png");
        std::fs::write(&file, b"image fixture").unwrap();
        self.project=serde_json::from_value(self.engine.call("asset.import",json!({"projectId":self.project.project.id,"expectedRevision":self.project.project.revision,"mode":mode,"files":[{"path":file}]})).unwrap()).unwrap();
    }
}

#[test]
fn create_reopen_and_persistent_history() {
    let mut f = Fixture::new();
    f.edit(json!({"type":"project.rename","name":"新名称"}));
    let engine = Engine::new(&f.dir.path().join("state")).unwrap();
    let view = engine.store.get(&f.project.project.id).unwrap();
    assert_eq!(view.project.name, "新名称");
    assert!(view.can_undo);
    f.history(false);
    assert_eq!(f.project.project.name, "测试 项目");
    assert!(f.project.can_redo);
    f.history(true);
    assert_eq!(f.project.project.name, "新名称");
    assert_eq!(f.project.project.revision, 3);
}
#[test]
fn stale_revision_is_rejected_without_partial_write() {
    let mut f = Fixture::new();
    f.edit(json!({"type":"project.rename","name":"一次修改"}));
    let error=f.engine.call("project.command",json!({"projectId":f.project.project.id,"expectedRevision":0,"command":{"type":"project.rename","name":"旧页面写入"}})).unwrap_err();
    assert!(error.contains("REVISION_CONFLICT"));
    assert_eq!(
        f.engine
            .store
            .get(&f.project.project.id)
            .unwrap()
            .project
            .name,
        "一次修改"
    );
}

#[test]
fn unknown_timed_media_never_becomes_a_five_second_clip() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    for kind in ["video", "audio"] {
        f.project.project.assets[0].media_type = kind.into();
        let track = if kind == "audio" { "a1" } else { "v1" };
        let result = workstation_core::commands::apply(
            &mut f.project.project,
            &json!({"type":"timeline.add","assetId":asset,"trackId":track}),
            &[],
        );
        assert!(result.unwrap_err().contains("时长未知"));
        assert!(f
            .project
            .project
            .timeline
            .as_ref()
            .unwrap()
            .clips
            .is_empty());
    }
    f.project.project.assets[0].media_type = "image".into();
    workstation_core::commands::apply(
        &mut f.project.project,
        &json!({"type":"timeline.add","assetId":asset,"trackId":"v1"}),
        &[],
    )
    .unwrap();
    let timeline = f.project.project.timeline.as_ref().unwrap();
    assert_eq!(
        timeline.clips[0].duration_ticks,
        timeline.timebase as i64 * 5
    );
}

#[test]
fn restore_source_preserves_placement_and_can_be_undone() {
    let mut f = Fixture::new();
    let file = f.dir.path().join("source.mkv");
    std::fs::write(&file, b"metadata supplied fixture").unwrap();
    f.project = serde_json::from_value(
        f.engine
            .call(
                "asset.import",
                json!({
                    "projectId":f.project.project.id,"expectedRevision":f.project.project.revision,
                    "mode":"link","files":[{"path":file,"metadata":{"duration":117.888}}]
                }),
            )
            .unwrap(),
    )
    .unwrap();
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","startTicks":2900000,"durationTicks":1200000}));
    let clip = f.project.project.timeline.as_ref().unwrap().clips[0].clone();
    f.edit(json!({"type":"timeline.update","clipId":clip.id,"inTicks":240000}));
    f.edit(json!({"type":"timeline.restoreSource","clipId":clip.id}));
    let restored = &f.project.project.timeline.as_ref().unwrap().clips[0];
    assert_eq!(restored.id, clip.id);
    assert_eq!(restored.start_ticks, clip.start_ticks);
    assert_eq!(restored.track_id, clip.track_id);
    assert_eq!(restored.in_ticks, 0);
    assert_eq!(restored.duration_ticks, 28293120);
    f.history(false);
    let undone = &f.project.project.timeline.as_ref().unwrap().clips[0];
    assert_eq!(undone.duration_ticks, 1200000);
    assert_eq!(undone.in_ticks, 240000);
}
#[test]
fn undo_then_new_edit_discards_only_redo_branch() {
    let mut f = Fixture::new();
    f.edit(json!({"type":"project.rename","name":"A"}));
    f.edit(json!({"type":"project.rename","name":"B"}));
    f.history(false);
    f.edit(json!({"type":"project.rename","name":"C"}));
    assert!(!f.project.can_redo);
    f.history(false);
    assert_eq!(f.project.project.name, "A");
    f.history(false);
    assert_eq!(f.project.project.name, "测试 项目");
}
#[test]
fn replace_preserves_links_private_options_and_undo() {
    let mut f = Fixture::new();
    let node = f.project.project.workspace.pages[0].clone();
    let links = f.project.project.workspace.links.clone();
    f.edit(json!({"type":"workspace.configure","nodeId":node.id,"expanded":true,"config":{"importMode":"copy"}}));
    let before = serde_json::to_value(&f.project.project.workspace).unwrap();
    let report=f.engine.call("workspace.replacementReport",json!({"projectId":f.project.project.id,"nodeId":node.id,"pluginId":"org.workstation.base","pageId":"export"})).unwrap();
    assert_eq!(report["connections"][0]["compatible"], false);
    f.edit(json!({"type":"workspace.replace","nodeId":node.id,"pluginId":"org.workstation.base","pageId":"export"}));
    assert_eq!(f.project.project.workspace.links.len(), links.len());
    assert_eq!(f.project.project.workspace.pages[0].id, node.id);
    assert!(f.project.project.workspace.pages[0].expanded);
    assert_eq!(
        f.project.project.archive[0].data["node"]["config"]["importMode"],
        "copy"
    );
    f.history(false);
    assert_eq!(
        serde_json::to_value(&f.project.project.workspace).unwrap(),
        before
    );
}
#[test]
fn incompatible_and_double_input_connections_do_not_modify_project() {
    let f = Fixture::new();
    let p = &f.project.project;
    let a = &p.workspace.pages[0];
    let b = &p.workspace.pages[1];
    for data_type in ["workstation.timeline@1", "workstation.assets@1"] {
        let result=f.engine.call("project.command",json!({"projectId":p.id,"expectedRevision":0,"command":{"type":"information.connect","source":a.id,"sourcePort":"assets","target":b.id,"targetPort":"assets","dataType":data_type}}));
        assert!(result.is_err());
    }
    assert_eq!(f.engine.store.get(&p.id).unwrap().project.revision, 0);
}
#[test]
fn disabling_plugin_keeps_project_and_information_links() {
    let f = Fixture::new();
    let before = serde_json::to_value(&f.project.project).unwrap();
    f.engine
        .call(
            "plugin.enable",
            json!({"pluginId":"org.workstation.base","enabled":false}),
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(f.engine.store.get(&f.project.project.id).unwrap().project).unwrap(),
        before
    );
    assert!(!f.engine.store.plugins().unwrap()[0].enabled);
}
#[test]
fn templates_clone_nodes_and_do_not_copy_assets_or_timeline() {
    let mut f = Fixture::new();
    f.import("link");
    let template = f
        .engine
        .call(
            "template.save",
            json!({"projectId":f.project.project.id,"name":"我的组合"}),
        )
        .unwrap();
    let next = f
        .engine
        .call(
            "project.create",
            json!({"parentDirectory":f.dir.path(),"name":"另一个项目","templateId":template["id"]}),
        )
        .unwrap();
    assert_eq!(next["assets"].as_array().unwrap().len(), 0);
    assert_eq!(next["timeline"]["clips"].as_array().unwrap().len(), 0);
    assert_ne!(
        next["workspace"]["pages"][0]["id"],
        template["workspace"]["pages"][0]["id"]
    );
    assert_eq!(
        next["workspace"]["links"][0]["source"],
        next["workspace"]["pages"][0]["id"]
    );
}
#[test]
fn copied_assets_use_project_relative_paths_and_survive_source_removal() {
    let mut f = Fixture::new();
    f.import("copy");
    let a = &f.project.project.assets[0];
    let relative = a.project_path.as_ref().unwrap();
    assert!(!std::path::Path::new(relative).is_absolute());
    assert!(std::path::Path::new(&f.project.directory)
        .join(relative)
        .is_file());
    std::fs::remove_file(f.dir.path().join("镜头 source.png")).unwrap();
    assert!(std::path::Path::new(&f.project.directory)
        .join(relative)
        .is_file());
    f.history(false);
    assert!(f.project.project.assets.is_empty());
    f.history(true);
    assert!(std::path::Path::new(&f.project.directory)
        .join(f.project.project.assets[0].project_path.as_ref().unwrap())
        .is_file());
}
#[test]
fn failed_import_does_not_partially_add_assets() {
    let f = Fixture::new();
    let file = f.dir.path().join("ok.png");
    std::fs::write(&file, b"x").unwrap();
    let result=f.engine.call("asset.import",json!({"projectId":f.project.project.id,"expectedRevision":0,"mode":"copy","files":[{"path":file},{"path":f.dir.path().join("missing.png")}]}));
    assert!(result.is_err());
    assert!(f
        .engine
        .store
        .get(&f.project.project.id)
        .unwrap()
        .project
        .assets
        .is_empty());
}
#[test]
fn archive_restore_asset_keeps_timeline_reference() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1"}));
    f.edit(json!({"type":"asset.archive","assetId":asset}));
    assert_eq!(
        f.project.project.timeline.as_ref().unwrap().clips[0].asset_id,
        asset
    );
    f.edit(json!({"type":"asset.restore","assetId":asset}));
    assert!(!f.project.project.assets[0].archived);
}
#[test]
fn split_maintains_source_offset_and_is_one_undo() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","durationTicks":1_200_000}));
    let clip = f.project.project.timeline.as_ref().unwrap().clips[0].clone();
    f.edit(json!({"type":"timeline.split","clipId":clip.id,"atTicks":480_000}));
    let clips = &f.project.project.timeline.as_ref().unwrap().clips;
    assert_eq!(clips[0].duration_ticks, 480_000);
    assert_eq!(clips[1].in_ticks, 480_000);
    assert_eq!(clips[1].duration_ticks, 720_000);
    f.history(false);
    assert_eq!(f.project.project.timeline.as_ref().unwrap().clips.len(), 1);
}
#[test]
fn invalid_timeline_time_rolls_back() {
    let mut f = Fixture::new();
    f.import("link");
    let a = f.project.project.assets[0].id.clone();
    let before = f.project.project.revision;
    assert!(f.engine.call("project.command",json!({"projectId":f.project.project.id,"expectedRevision":before,"command":{"type":"timeline.add","assetId":a,"trackId":"v1","durationTicks":-1}})).is_err());
    assert_eq!(
        f.engine
            .store
            .get(&f.project.project.id)
            .unwrap()
            .project
            .revision,
        before
    );
}

#[test]
fn overwrite_cuts_intervals_not_layers_and_preserves_source_offsets() {
    for (start, duration, expected) in [
        (0, 3, vec![(3, 7, 5)]),
        (7, 5, vec![(0, 7, 2)]),
        (3, 4, vec![(0, 3, 2), (7, 3, 9)]),
        (0, 10, vec![]),
        (10, 2, vec![(0, 10, 2)]),
    ] {
        let mut f = Fixture::new();
        f.import("link");
        let asset = f.project.project.assets[0].id.clone();
        f.edit(
            json!({"type":"timeline.add","assetId":asset,"trackId":"v1","durationTicks":2400000}),
        );
        let old_id = f.project.project.timeline.as_ref().unwrap().clips[0]
            .id
            .clone();
        f.edit(json!({"type":"timeline.update","clipId":old_id,"inTicks":480000}));
        let before = serde_json::to_value(&f.project.project.timeline).unwrap();
        f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","startTicks":start*240000,"durationTicks":duration*240000}));
        let incoming = f
            .project
            .project
            .timeline
            .as_ref()
            .unwrap()
            .clips
            .last()
            .unwrap()
            .id
            .clone();
        let mut pieces: Vec<_> = f
            .project
            .project
            .timeline
            .as_ref()
            .unwrap()
            .clips
            .iter()
            .filter(|c| c.id != incoming)
            .map(|c| {
                (
                    c.start_ticks / 240000,
                    c.duration_ticks / 240000,
                    c.in_ticks / 240000,
                )
            })
            .collect();
        pieces.sort();
        assert_eq!(pieces, expected);
        f.edit(json!({"type":"timeline.remove","clipId":incoming}));
        assert_eq!(
            f.project.project.timeline.as_ref().unwrap().clips.len(),
            expected.len()
        );
        f.history(false);
        f.history(false);
        assert_eq!(
            serde_json::to_value(&f.project.project.timeline).unwrap(),
            before
        );
    }
}

#[test]
fn moving_overwrites_destination_but_upper_tracks_leave_lower_tracks_intact() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","durationTicks":2400000}));
    let lower = f.project.project.timeline.as_ref().unwrap().clips[0]
        .id
        .clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v2","startTicks":720000,"durationTicks":480000}));
    let upper = f
        .project
        .project
        .timeline
        .as_ref()
        .unwrap()
        .clips
        .last()
        .unwrap()
        .id
        .clone();
    assert_eq!(
        f.project.project.timeline.as_ref().unwrap().clips[0].duration_ticks,
        2400000
    );
    f.edit(json!({"type":"timeline.update","clipId":upper,"trackId":"v1"}));
    let timeline = f.project.project.timeline.as_ref().unwrap();
    assert_eq!(timeline.clips.len(), 3);
    assert_eq!(
        timeline
            .clips
            .iter()
            .find(|c| c.id == lower)
            .unwrap()
            .duration_ticks,
        720000
    );
    assert_eq!(
        timeline
            .clips
            .iter()
            .find(|c| c.start_ticks == 1200000)
            .unwrap()
            .in_ticks,
        1200000
    );
    f.history(false);
    assert_eq!(f.project.project.timeline.as_ref().unwrap().clips.len(), 2);
    f.edit(json!({"type":"timeline.remove","clipId":upper}));
    assert_eq!(
        f.project.project.timeline.as_ref().unwrap().clips[0].duration_ticks,
        2400000
    );
}

#[test]
fn explicit_legacy_cleanup_uses_later_clip_and_archives_covered_piece() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","durationTicks":2400000}));
    let timeline = f.project.project.timeline.as_mut().unwrap();
    let mut later = timeline.clips[0].clone();
    later.id = "legacy-later".into();
    later.start_ticks = 720000;
    later.duration_ticks = 480000;
    timeline.clips.push(later);
    workstation_core::commands::apply(
        &mut f.project.project,
        &json!({"type":"timeline.resolveOverlaps"}),
        &[],
    )
    .unwrap();
    assert_eq!(f.project.project.timeline.as_ref().unwrap().clips.len(), 3);
    let entry = f.project.project.archive.last().unwrap().clone();
    assert_eq!(entry.data["startTicks"], 720000);
    assert_eq!(entry.data["inTicks"], 720000);
    assert_eq!(entry.data["durationTicks"], 480000);
    workstation_core::commands::apply(
        &mut f.project.project,
        &json!({"type":"archive.restore","archiveId":entry.id}),
        &[],
    )
    .unwrap();
    assert!(!f
        .project
        .project
        .timeline
        .as_ref()
        .unwrap()
        .clips
        .iter()
        .any(|c| c.id == "legacy-later"));
}
#[test]
fn unsupported_semantic_search_is_not_disguised_as_keyword_search() {
    let f = Fixture::new();
    let error = f
        .engine
        .call(
            "asset.search",
            json!({"projectId":f.project.project.id,"query":"海边的日落","mode":"semantic"}),
        )
        .unwrap_err();
    assert!(error.contains("CAPABILITY_UNAVAILABLE"));
}
#[test]
fn remove_and_restore_page_preserves_identity_and_position() {
    let mut f = Fixture::new();
    let node = f.project.project.workspace.pages[1].clone();
    f.edit(json!({"type":"workspace.remove","nodeId":node.id}));
    let archive = f.project.project.archive[0].id.clone();
    f.edit(json!({"type":"archive.restore","archiveId":archive}));
    assert_eq!(
        serde_json::to_value(&f.project.project.workspace.pages[1]).unwrap(),
        serde_json::to_value(&node).unwrap()
    );
}
#[test]
fn create_never_overwrites_an_existing_directory() {
    let f = Fixture::new();
    let result = f.engine.call(
        "project.create",
        json!({"name":"测试 项目","parentDirectory":f.dir.path()}),
    );
    assert!(result.unwrap_err().contains("不能覆盖已有目录"));
    assert_eq!(
        f.engine
            .store
            .get(&f.project.project.id)
            .unwrap()
            .project
            .name,
        "测试 项目"
    );
}

#[test]
fn information_resolve_reads_bound_assets_without_running_or_mutating() {
    let mut f = Fixture::new();
    f.import("link");
    let node = f.project.project.workspace.pages[1].id.clone();
    let revision = f.project.project.revision;
    let result = f
        .engine
        .call(
            "information.resolve",
            json!({"projectId":f.project.project.id,"nodeId":node}),
        )
        .unwrap();
    assert_eq!(result["bindings"][0]["status"], "available");
    assert_eq!(
        result["bindings"][0]["value"]["assets"][0]["id"],
        f.project.project.assets[0].id
    );
    assert_eq!(
        f.engine
            .store
            .get(&f.project.project.id)
            .unwrap()
            .project
            .revision,
        revision
    );
    f.engine
        .call(
            "plugin.enable",
            json!({"pluginId":"org.workstation.base","enabled":false}),
        )
        .unwrap();
    let missing = f
        .engine
        .call(
            "information.resolve",
            json!({"projectId":f.project.project.id,"nodeId":node}),
        )
        .unwrap();
    assert_eq!(missing["bindings"][0]["status"], "source-unavailable");
}

#[test]
fn explicitly_published_information_and_private_page_state_survive_replacement() {
    let mut f = Fixture::new();
    let source = f.project.project.workspace.pages[0].id.clone();
    let target = f.project.project.workspace.pages[1].id.clone();
    f.edit(json!({"type":"workspace.state","nodeId":source,"state":{"selectedAsset":"example"}}));
    f.edit(json!({"type":"information.publish","nodeId":source,"portId":"assets","value":{"projectId":f.project.project.id,"assets":[]}}));
    let resolved = f
        .engine
        .call(
            "information.resolve",
            json!({"projectId":f.project.project.id,"nodeId":target}),
        )
        .unwrap();
    assert_eq!(resolved["bindings"][0]["value"]["assets"], json!([]));
    f.edit(json!({"type":"workspace.replace","nodeId":source,"pluginId":"org.workstation.base","pageId":"export"}));
    assert_eq!(
        f.project.project.archive[0].data["node"]["privateState"]["pageState"]["selectedAsset"],
        "example"
    );
    f.history(false);
    assert_eq!(
        f.project.project.workspace.pages[0].private_state["pageState"]["selectedAsset"],
        "example"
    );
}

#[test]
fn video_settings_preserve_clip_time_and_survive_undo_and_reopen() {
    let mut f = Fixture::new();
    f.import("link");
    let asset = f.project.project.assets[0].id.clone();
    f.edit(json!({"type":"timeline.add","assetId":asset,"trackId":"v1","startTicks":24000,"durationTicks":1200000}));
    let before = f.project.project.timeline.clone().unwrap();
    f.edit(json!({"type":"timeline.settings","settings":{"width":3840,"height":2160,"frameRate":{"numerator":60000,"denominator":1001}}}));
    let after = f
        .engine
        .store
        .get(&f.project.project.id)
        .unwrap()
        .project
        .timeline
        .unwrap();
    assert_eq!(after.width, 3840);
    assert_eq!(after.frame_rate.numerator, 60000);
    assert_eq!(after.frame_rate.denominator, 1001);
    assert_eq!(after.timebase, before.timebase);
    assert_eq!(after.clips[0].start_ticks, before.clips[0].start_ticks);
    assert_eq!(
        after.clips[0].duration_ticks,
        before.clips[0].duration_ticks
    );
    f.history(false);
    assert_eq!(f.project.project.timeline.as_ref().unwrap().width, 1920);
    let rev = f.project.project.revision;
    assert!(f.engine.call("project.command",json!({"projectId":f.project.project.id,"expectedRevision":rev,"command":{"type":"timeline.settings","settings":{"width":0,"height":1080,"frameRate":{"numerator":24,"denominator":1}}}})).is_err());
    assert_eq!(
        f.engine
            .store
            .get(&f.project.project.id)
            .unwrap()
            .project
            .revision,
        rev
    );
}

#[test]
fn project_can_start_with_custom_video_settings() {
    let f = Fixture::new();
    let result=f.engine.call("project.create",json!({"name":"竖屏项目","parentDirectory":f.dir.path(),"timelineSettings":{"width":1080,"height":1920,"frameRate":{"numerator":120,"denominator":2}}})).unwrap();
    assert_eq!(result["timeline"]["width"], 1080);
    assert_eq!(result["timeline"]["height"], 1920);
    assert_eq!(result["timeline"]["frameRate"]["numerator"], 60);
    assert_eq!(result["timeline"]["frameRate"]["denominator"], 1);
}

#[test]
fn abandoned_media_job_is_marked_interrupted_when_its_owner_lock_is_free() {
    let f = Fixture::new();
    let job_id = "orphan-job";
    std::fs::create_dir_all(f.engine.store.root.join("media-jobs").join(job_id)).unwrap();
    let job = workstation_core::media::MediaJob {
        id: job_id.into(),
        project_id: f.project.project.id.clone(),
        project_revision: 0,
        status: "running".into(),
        progress: 0.3,
        output_path: "output.mp4".into(),
        staging_path: "output.partial".into(),
        profile: "mp4-h264".into(),
        created_at: 0,
        updated_at: 0,
        error: None,
        log_path: "worker.log".into(),
        pipeline_audit: None,
    };
    f.engine
        .store
        .catalog
        .execute(
            "INSERT INTO media_jobs(id,project_id,body) VALUES(?1,?2,?3)",
            rusqlite::params![job.id, job.project_id, serde_json::to_string(&job).unwrap()],
        )
        .unwrap();
    let jobs = f.engine.media.jobs(Some(&f.project.project.id)).unwrap();
    assert_eq!(jobs[0].status, "interrupted");
    assert!(jobs[0].error.as_ref().unwrap().contains("Core"));
}
