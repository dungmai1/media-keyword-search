# Media Keyword Search

Desktop app (Electron) tìm ảnh/video trên Pexels và Pixabay từ một danh sách keyword.
Người dùng tự nhập API key trong app (nút **⚙ API keys**); key được mã hoá bằng keychain của hệ điều hành và lưu trên máy họ.

## Chạy khi phát triển

```bash
npm install
npm run app      # mở app Electron
npm run web      # hoặc chạy bản web tại http://localhost:3000 (key lưu trong .env)
```

## Build file cài

```bash
npm run dist     # build cho hệ điều hành hiện tại, kết quả ở dist/
```

## Phát hành bằng GitHub Actions

Workflow `.github/workflows/release.yml` build trên macOS (dmg arm64 + x64), Windows (exe) và Linux (AppImage).

- Push tag `vX.Y.Z` (khớp `version` trong `package.json`) → tạo **draft** GitHub Release kèm file cài; vào Releases bấm Publish.
- Chạy tay ("Run workflow") → chỉ build, tải file cài ở mục Artifacts của lần chạy.

## Lưu ý cho người dùng

App chưa ký số:

- **macOS**: lần đầu mở bằng chuột phải → Open. Nếu báo "đã bị hỏng", chạy `xattr -cr "/Applications/Media Keyword Search.app"`.
- **Windows**: SmartScreen cảnh báo → More info → Run anyway.
# media-keyword-search
