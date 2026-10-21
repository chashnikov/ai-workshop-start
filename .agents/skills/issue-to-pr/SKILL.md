---
name: issue-to-pr
description: Create a pull request from an issue.
---

# issue-to-pr

Read the issue description labeled with `Delegated to AI` and create a pull request for it.

## Asking for clarifications

If it isn't clear how to implement the issue, ask for help using `communication` skill.
Wait until a human responds, and then continue taking the answer into account.

## Updating screenshots

If a pull request is expected to modify the user interface, update the screenshots in `e2e/screenshots`.

## Sample video

Attach a sample MP4 video to the pull request that shows the change working in the web view.
- If the change is not shown by the scenario in `scripts/record-demo.ts`, extend the scenario (and `spec/demo.md`, its tests) in the same pull request.
- Record it headless, it works without a display: `npm run demo -- --out recordings/demo.webm`
  (once: `npx playwright install --only-shell chromium`).
- Convert it to MP4: `ffmpeg -y -i recordings/demo.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart recordings/demo.mp4`.
  It needs an `ffmpeg` with libx264 (`.air/cloud/startup.sh` installs one as root; Playwright's own is VP8-only).
  If there is none and you cannot install it (`apt-get install -y ffmpeg`), attach `recordings/demo.webm` as `demo.webm` instead,
  and say in the pull request description why it is not an MP4.
- Check a few frames (`ffmpeg -i recordings/demo.webm -vf fps=1/2,scale=640:-1,tile=3x2 -frames:v 1 recordings/frames.png`,
  in `recordings/`, which is ignored) before attaching it.
- GitHub has no API for attachments, so attach it through the `pr-videos` branch, never the pull request's own branch:
  commit it as `pr-<number>/demo.mp4` there (create the branch as an orphan if it does not exist yet),
  push, and add `[Sample video](https://github.com/<owner>/<repo>/blob/pr-videos/pr-<number>/demo.mp4)` to the pull request description.
- Record it again, the same way, whenever the pull request changes what the video shows.

## Monitoring

After creating the pull request, monitor it during the next hour. 
If new comments appear, address them using `address-review` skill.
Stop monitoring if the pull request is merged or closed.
