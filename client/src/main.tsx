import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  api,
  type Field,
  type Sample,
  type SearchResult,
  type SampleImage,
} from "./api";
import "./style.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const useFields = () =>
  useQuery({
    queryKey: ["fields"],
    queryFn: () => api<Field[]>("/custom-fields"),
  });
const statusLabel: Record<string, string> = {
  pending: "待入库",
  indexing: "同步中",
  indexed: "已入库",
  failed: "入库失败",
  delete_pending: "删除待重试",
  deleted: "已删除",
};
function Status({ image }: { image: SampleImage }) {
  return (
    <Tag
      color={
        image.indexStatus === "indexed"
          ? "green"
          : image.indexStatus === "failed"
            ? "red"
            : "gold"
      }
    >
      {statusLabel[image.indexStatus] || image.indexStatus}
    </Tag>
  );
}
function Shell() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ databaseConnected: boolean }>("/health"),
  });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-mark"
            src="/jinjian.svg"
            alt=""
            aria-hidden="true"
          />
          <div>
            <span className="brand-name">锦鉴</span>
            <small>鉴纹识锦 · 面料图库</small>
          </div>
        </div>
        <div className="nav-title">工作空间</div>
        <nav>
          <NavLink to="/" end>
            <AppstoreOutlined /> 样品管理
          </NavLink>
          <NavLink to="/search">
            <SearchOutlined /> 以图搜样品
          </NavLink>
          <NavLink to="/fields">
            <SettingOutlined /> 字段设置
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> 样品图库
          <small>用图片，找到每一块面料。</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>面料样品检索工具</span>
        </header>
        <div className="content">
          {health.isError && (
            <Alert
              type="error"
              showIcon
              message="后端连接失败"
              description={String(health.error.message)}
              style={{ marginBottom: 20 }}
            />
          )}
          {health.data?.databaseConnected === false && (
            <Alert
              type="error"
              showIcon
              message="数据库暂时无法连接，请稍后重试。"
              style={{ marginBottom: 20 }}
            />
          )}
          <Routes>
            <Route path="/" element={<Samples />} />
            <Route path="/search" element={<Search />} />
            <Route path="/fields" element={<Fields />} />
            <Route
              path="*"
              element={
                <Empty description="页面不存在">
                  <Button href="/">返回样品管理</Button>
                </Empty>
              }
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  extra,
}: {
  eyebrow: string;
  title: string;
  description: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {extra}
    </div>
  );
}
function FieldInput({ field }: { field: Field }) {
  if (field.type === "number")
    return (
      <InputNumber
        style={{ width: "100%" }}
        placeholder={`填写${field.label}`}
      />
    );
  if (field.type === "select")
    return (
      <Select
        allowClear
        options={field.options.map((value) => ({ label: value, value }))}
        placeholder={`选择${field.label}`}
      />
    );
  return <Input placeholder={`填写${field.label}`} maxLength={1000} />;
}
function Samples() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const fields = useFields();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sample>();
  const [detailId, setDetailId] = useState<string>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const samples = useQuery({
    queryKey: ["samples", q, page],
    queryFn: () =>
      api<{ items: Sample[]; total: number }>(
        `/samples?q=${encodeURIComponent(q)}&page=${page}&pageSize=12`,
      ),
    refetchInterval: 10000,
  });
  function showEditor(sample?: Sample) {
    form.resetFields();
    setEditing(sample);
    setFiles([]);
    if (sample) form.setFieldsValue(sample);
    setOpen(true);
  }
  async function save() {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!editing && !files.length) {
      message.warning("请至少上传一张图片");
      return;
    }
    setBusy(true);
    try {
      const attributes = {
        ...(editing?.attributes || {}),
        ...(values.attributes || {}),
      };
      for (const key of Object.keys(attributes))
        if (attributes[key] == null) delete attributes[key];
      const data = { code: values.code, name: values.name, attributes };
      let result: Sample;
      if (editing)
        result = await api<Sample>(`/samples/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
      else {
        const body = new FormData();
        body.append("data", JSON.stringify(data));
        files.forEach((file) =>
          body.append("images", file.originFileObj as File),
        );
        result = await api<Sample>("/samples", { method: "POST", body });
      }
      await cache.invalidateQueries({ queryKey: ["samples"] });
      await cache.invalidateQueries({ queryKey: ["sample"] });
      setOpen(false);
      if (result.images.some((i) => i.indexStatus === "failed"))
        message.warning("样品已保存，部分图片入库失败，可在详情中重试");
      else message.success(editing ? "样品已更新" : "样品已创建并入库");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/samples/${id}`, { method: "DELETE" });
      message.success("样品已删除");
      await cache.invalidateQueries({ queryKey: ["samples"] });
      await cache.invalidateQueries({ queryKey: ["cleanup"] });
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="YOUR MATERIAL LIBRARY"
        title="样品管理"
        description="记录面料的纹理与细节，建立属于你的样品图库。"
        extra={
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => showEditor()}
          >
            创建样品
          </Button>
        }
      />
      <div className="toolbar">
        <Input.Search
          allowClear
          placeholder="搜索样品名称或编号"
          onSearch={(value) => {
            setQ(value);
            setPage(1);
          }}
          style={{ maxWidth: 360 }}
        />
        <span>{samples.data?.total || 0} 个样品</span>
        <Button icon={<ReloadOutlined />} onClick={() => samples.refetch()}>
          刷新
        </Button>
      </div>
      {samples.isError ? (
        <Alert type="error" message={samples.error.message} />
      ) : (
        <Spin spinning={samples.isLoading}>
          <div className="sample-grid">
            {samples.data?.items.map((sample) => (
              <Card
                key={sample.id}
                className="sample-card"
                cover={
                  <div
                    className="sample-cover"
                    onClick={() => setDetailId(sample.id)}
                  >
                    {sample.images[0] ? (
                      <img
                        src={sample.images[0].thumbnailPath}
                        alt={sample.name}
                      />
                    ) : (
                      <FileImageOutlined />
                    )}
                    <span className="image-count">
                      {sample.images.length} 张图片
                    </span>
                  </div>
                }
              >
                <div className="sample-code">{sample.code}</div>
                <h3 onClick={() => setDetailId(sample.id)}>{sample.name}</h3>
                <div className="sample-attrs">
                  {(fields.data || [])
                    .filter(
                      (f) =>
                        f.showInResults &&
                        sample.attributes[f.key] !== undefined,
                    )
                    .slice(0, 3)
                    .map((field) => (
                      <span key={field.key}>
                        {field.label}：{sample.attributes[field.key]}
                      </span>
                    ))}
                </div>
                <div className="card-footer">
                  <Tag
                    color={
                      sample.images.every((i) => i.indexStatus === "indexed")
                        ? "green"
                        : "orange"
                    }
                  >
                    {
                      sample.images.filter((i) => i.indexStatus === "indexed")
                        .length
                    }
                    /{sample.images.length} 已入库
                  </Tag>
                  <Space>
                    <Button
                      type="text"
                      aria-label="编辑样品"
                      icon={<EditOutlined />}
                      onClick={() => showEditor(sample)}
                    />
                    <Popconfirm
                      title="删除此样品及关联图库图片？"
                      onConfirm={() => remove(sample.id)}
                    >
                      <Button
                        type="text"
                        danger
                        aria-label="删除样品"
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              </Card>
            ))}
          </div>
          {!samples.isLoading && !samples.data?.items.length && (
            <div className="empty-panel">
              <Empty
                description={
                  q
                    ? "没有符合条件的样品"
                    : "从第一块面料开始，创建你的样品档案"
                }
              >
                <Button type="primary" onClick={() => showEditor()}>
                  创建样品
                </Button>
              </Empty>
            </div>
          )}
        </Spin>
      )}
      <Pagination
        hideOnSinglePage
        current={page}
        total={samples.data?.total}
        pageSize={12}
        showSizeChanger={false}
        onChange={setPage}
        style={{ marginTop: 24, textAlign: "right" }}
      />
      <div className="search-prompt">
        <div>
          <strong>手里有图片，想找相似面料？</strong>
          <p>上传一张照片，从已入库样品中寻找纹理与颜色的线索。</p>
        </div>
        <Button
          onClick={() => navigate("/search")}
          icon={<ArrowRightOutlined />}
        >
          开始以图搜索
        </Button>
      </div>
      <Modal
        title={editing ? "编辑样品" : "创建样品"}
        open={open}
        onCancel={() => !busy && setOpen(false)}
        onOk={save}
        confirmLoading={busy}
        maskClosable={!busy}
        closable={!busy}
        cancelButtonProps={{ disabled: busy }}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-grid">
            <Form.Item
              name="code"
              label="样品编号"
              rules={[
                { required: true, message: "填写样品编号" },
                {
                  pattern: /^[a-zA-Z0-9_-]+$/,
                  message: "仅支持字母、数字、下划线和横线",
                },
              ]}
            >
              <Input
                disabled={!!editing}
                placeholder="例如 YL-001"
                maxLength={64}
              />
            </Form.Item>
            <Form.Item
              name="name"
              label="样品名称"
              rules={[
                { required: true, whitespace: true, message: "填写样品名称" },
              ]}
            >
              <Input placeholder="例如 蓝色提花面料" maxLength={100} />
            </Form.Item>
            {fields.data?.map((field) => (
              <Form.Item
                key={field.key}
                name={["attributes", field.key]}
                label={field.label}
                rules={[
                  { required: field.required, message: `请填写${field.label}` },
                ]}
              >
                <FieldInput field={field} />
              </Form.Item>
            ))}
          </div>
          {!editing && (
            <Form.Item label="面料图片 · 最多 12 张" required>
              <Upload.Dragger
                accept="image/jpeg,image/png,image/webp"
                multiple
                beforeUpload={() => false}
                maxCount={12}
                fileList={files}
                onChange={({ fileList }) => setFiles(fileList)}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p>点击或拖拽上传面料图片</p>
                <p className="ant-upload-hint">
                  JPG / PNG / WebP，单张不超过 10 MB，短边至少 50 像素
                </p>
              </Upload.Dragger>
            </Form.Item>
          )}
          {editing && <p className="muted">添加或删除图片请打开样品详情。</p>}
        </Form>
      </Modal>
      <Detail id={detailId} onClose={() => setDetailId(undefined)} />
    </>
  );
}
function Detail({ id, onClose }: { id?: string; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const cache = useQueryClient();
  const fields = useFields();
  const [busy, setBusy] = useState(false);
  const [newFiles, setNewFiles] = useState<UploadFile[]>([]);
  const sample = useQuery({
    queryKey: ["sample", id],
    queryFn: () => api<Sample>(`/samples/${id}`),
    enabled: !!id,
  });
  useEffect(() => {
    setNewFiles([]);
  }, [id]);
  async function action(url: string, method = "POST", body?: FormData) {
    setBusy(true);
    try {
      const result: any = await api(url, { method, body });
      if (
        result.indexStatus === "failed" ||
        result.indexStatus === "delete_pending" ||
        result.images?.some((i: SampleImage) => i.indexStatus === "failed")
      )
        message.warning(
          result.lastError || "操作已保存，部分图片同步失败，请检查状态并重试",
        );
      else message.success("操作成功");
      setNewFiles([]);
      await cache.invalidateQueries({ queryKey: ["sample", id] });
      await cache.invalidateQueries({ queryKey: ["samples"] });
      await cache.invalidateQueries({ queryKey: ["cleanup"] });
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title="样品详情" width={680} open={!!id} onClose={onClose}>
      <Spin spinning={sample.isLoading || busy}>
        {sample.isError && (
          <Alert type="error" message={sample.error.message} />
        )}
        {sample.data && (
          <>
            <div className="detail-heading">
              <span className="sample-code">{sample.data.code}</span>
              <h2>{sample.data.name}</h2>
            </div>
            <Descriptions
              column={2}
              items={[
                ...(fields.data || []).map((field) => ({
                  key: field.key,
                  label: field.label,
                  children: sample.data!.attributes[field.key] ?? "—",
                })),
                {
                  key: "created",
                  label: "创建时间",
                  children: new Date(sample.data.createdAt).toLocaleString(
                    "zh-CN",
                  ),
                },
              ]}
            />
            <h3>样品图片</h3>
            <Image.PreviewGroup>
              <div className="detail-images">
                {sample.data.images.map((image) => (
                  <div className="detail-image" key={image.id}>
                    <Image src={image.path} alt={sample.data!.name} />
                    <Status image={image} />
                    {image.lastError && (
                      <p className="error-text">{image.lastError}</p>
                    )}
                    <Space wrap>
                      {image.indexStatus !== "indexed" && (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            action(`/images/${image.id}/retry-index`)
                          }
                        >
                          重新入库
                        </Button>
                      )}
                      <Popconfirm
                        title="删除这张图片？"
                        onConfirm={() =>
                          action(`/images/${image.id}`, "DELETE")
                        }
                      >
                        <Button
                          size="small"
                          danger
                          disabled={busy || sample.data!.images.length <= 1}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
            <h3>追加图片</h3>
            <Upload
              accept="image/jpeg,image/png,image/webp"
              multiple
              beforeUpload={() => false}
              fileList={newFiles}
              maxCount={Math.max(0, 12 - sample.data.images.length)}
              onChange={({ fileList }) => setNewFiles(fileList)}
              disabled={busy || sample.data.images.length >= 12}
            >
              <Button icon={<PlusOutlined />}>选择图片</Button>
            </Upload>
            {newFiles.length > 0 && (
              <Button
                style={{ marginTop: 12 }}
                type="primary"
                loading={busy}
                onClick={() => {
                  const body = new FormData();
                  newFiles.forEach((file) =>
                    body.append("images", file.originFileObj as File),
                  );
                  action(`/samples/${id}/images`, "POST", body);
                }}
              >
                上传并入库
              </Button>
            )}
          </>
        )}
      </Spin>
    </Drawer>
  );
}
function Search() {
  const { message } = AntApp.useApp();
  const fields = useFields();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResult>();
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(20);
  const [minScore, setMinScore] = useState(0);
  const [detailId, setDetailId] = useState<string>();
  useEffect(() => {
    const file = files[0]?.originFileObj;
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [files]);
  async function search() {
    if (!files[0]?.originFileObj) {
      message.warning("先上传查询图片");
      return;
    }
    setBusy(true);
    setResult(undefined);
    setError("");
    try {
      const body = new FormData();
      body.append("image", files[0].originFileObj);
      body.append("limit", String(limit));
      body.append("minScore", String(minScore / 100));
      setResult(
        await api<SearchResult>("/image-search", { method: "POST", body }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="SEARCH BY IMAGE"
        title="以图搜样品"
        description="以灰度图比对面料纹理与组织结构，结果展示原始彩色样品。"
      />
      <div className="search-layout">
        <Card className="query-panel">
          <h3>上传查询图片</h3>
          <Upload.Dragger
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            beforeUpload={() => false}
            maxCount={1}
            fileList={files}
            onChange={({ fileList }) => {
              setFiles(fileList);
              setResult(undefined);
              setError("");
            }}
            showUploadList={false}
          >
            {preview ? (
              <img className="query-preview" src={preview} alt="查询图片" />
            ) : (
              <>
                <p className="ant-upload-drag-icon">
                  <CloudUploadOutlined />
                </p>
                <p>拖拽面料照片到这里</p>
                <p className="ant-upload-hint">或点击选择图片</p>
              </>
            )}
          </Upload.Dragger>
          {preview && (
            <Button
              type="link"
              disabled={busy}
              onClick={() => {
                setFiles([]);
                setResult(undefined);
              }}
            >
              移除图片
            </Button>
          )}
          <p className="muted">
            尽量使用面料平铺图或纹理近景图，减少背景干扰。单张不超过 10 MB。
          </p>
          <div className="search-controls">
            <label>展示数量</label>
            <Select
              value={limit}
              disabled={busy}
              onChange={setLimit}
              options={[10, 20, 50].map((value) => ({
                value,
                label: `前 ${value} 个样品`,
              }))}
              style={{ width: "100%" }}
            />
            <label>
              最低纹理相关度 <span>{minScore}%</span>
            </label>
            <Slider value={minScore} disabled={busy} onChange={setMinScore} />
            <Button
              type="primary"
              block
              size="large"
              icon={<SearchOutlined />}
              loading={busy}
              onClick={search}
            >
              查找相似样品
            </Button>
          </div>
        </Card>
        <Card className="result-panel">
          <div className="result-heading">
            <h3>匹配结果</h3>
            {result && (
              <span>
                {result.matchedSamples} 个匹配 ·{" "}
                {(result.durationMs / 1000).toFixed(1)} 秒
              </span>
            )}
          </div>
          {error && (
            <Alert
              type="error"
              showIcon
              message="搜索失败"
              description={error}
              action={
                <Button size="small" onClick={search}>
                  重试
                </Button>
              }
            />
          )}
          <Spin spinning={busy} tip="正在比对面料纹理…">
            <div className="result-body">
              {result ? (
                <>
                  <p className="muted">
                    按纹理相关度排序，同一样品仅展示一次。分数表示灰度图片相关性。
                  </p>
                  <Table
                    rowKey="id"
                    dataSource={result.items}
                    pagination={false}
                    scroll={{ x: 640 }}
                    locale={{
                      emptyText:
                        "没有达到筛选条件的已入库样品，请换一张图片或降低阈值。",
                    }}
                    columns={[
                      {
                        title: "图片",
                        key: "image",
                        width: 90,
                        render: (_, row) => (
                          <Image
                            width={64}
                            height={64}
                            style={{ objectFit: "cover", borderRadius: 6 }}
                            src={row.matchedImage.thumbnailPath}
                            preview={{ src: row.matchedImage.path }}
                            alt={row.name}
                          />
                        ),
                      },
                      {
                        title: "样品",
                        key: "sample",
                        width: 150,
                        render: (_, row) => (
                          <>
                            <Button
                              type="link"
                              style={{ padding: 0 }}
                              onClick={() => setDetailId(row.id)}
                            >
                              {row.name}
                            </Button>
                            <div className="sample-code">{row.code}</div>
                          </>
                        ),
                      },
                      ...(fields.data || [])
                        .filter((field) => field.showInResults)
                        .map((field) => ({
                          title: field.label,
                          key: field.key,
                          render: (
                            _: unknown,
                            row: SearchResult["items"][number],
                          ) => row.attributes[field.key] ?? "—",
                        })),
                      {
                        title: "纹理相关度",
                        key: "score",
                        width: 100,
                        render: (_, row) => (
                          <span className="score">
                            {(row.score * 100).toFixed(1)}%
                          </span>
                        ),
                      },
                    ]}
                  />
                </>
              ) : (
                !error && (
                  <Empty
                    image={
                      <div className="search-empty-icon">
                        <SearchOutlined />
                      </div>
                    }
                    description={
                      busy
                        ? "正在搜索，请稍候"
                        : "上传一张面料图片，开启你的第一次搜索"
                    }
                  />
                )
              )}
            </div>
          </Spin>
        </Card>
      </div>
      <Detail id={detailId} onClose={() => setDetailId(undefined)} />
    </>
  );
}
function Fields() {
  const { message } = AntApp.useApp();
  const cache = useQueryClient();
  const fields = useFields();
  const cleanup = useQuery({
    queryKey: ["cleanup"],
    queryFn: () =>
      api<(SampleImage & { sample: { code: string; name: string } })[]>(
        "/cleanup-tasks",
      ),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field>();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const fieldType = Form.useWatch("type", form);
  function editor(field?: Field) {
    setEditing(field);
    form.resetFields();
    form.setFieldsValue(
      field
        ? { ...field, optionsText: field.options.join("\n") }
        : { type: "text", required: false, showInResults: true, sortOrder: 0 },
    );
    setOpen(true);
  }
  async function save() {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    try {
      const { optionsText, ...data } = values;
      data.options =
        values.type === "select"
          ? (optionsText || "")
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];
      await api(editing ? `/custom-fields/${editing.id}` : "/custom-fields", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(data),
      });
      await cache.invalidateQueries({ queryKey: ["fields"] });
      setOpen(false);
      message.success("字段配置已保存");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/custom-fields/${id}`, { method: "DELETE" });
      await cache.invalidateQueries({ queryKey: ["fields"] });
      message.success("字段已移除，已有样品中的历史值保留");
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function retryDelete(id: string) {
    try {
      const result = await api<SampleImage>(`/images/${id}/retry-delete`, {
        method: "POST",
      });
      if (result.indexStatus === "delete_pending")
        message.error(result.lastError);
      else message.success("图库清理完成");
      await cleanup.refetch();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="MAKE IT YOUR OWN"
        title="字段设置"
        description="编号与名称是固定字段，其余信息由你定义。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => editor()}
          >
            添加字段
          </Button>
        }
      />
      <Alert
        showIcon
        type="info"
        message="字段配置全局生效。新增必填字段后，已有样品在下次编辑时需要补充。"
        style={{ marginBottom: 20 }}
      />
      {fields.isError && <Alert type="error" message={fields.error.message} />}
      <Card>
        <Table
          rowKey="id"
          dataSource={fields.data}
          loading={fields.isLoading}
          pagination={false}
          scroll={{ x: 680 }}
          columns={[
            { title: "字段名称", dataIndex: "label" },
            { title: "字段标识", dataIndex: "key" },
            {
              title: "类型",
              dataIndex: "type",
              render: (value) =>
                ({ text: "文本", number: "数字", select: "下拉选项" })[
                  value as "text"
                ],
            },
            {
              title: "必填",
              dataIndex: "required",
              render: (value) => (value ? "是" : "否"),
            },
            {
              title: "搜索结果展示",
              dataIndex: "showInResults",
              render: (value) => (value ? "展示" : "隐藏"),
            },
            { title: "排序", dataIndex: "sortOrder" },
            {
              title: "操作",
              key: "actions",
              render: (_, row) => (
                <Space>
                  <Button type="link" onClick={() => editor(row)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="移除此字段？历史参数值会保留。"
                    onConfirm={() => remove(row.id)}
                  >
                    <Button type="link" danger>
                      移除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {!!cleanup.data?.length && (
        <Card title="图库清理待重试" style={{ marginTop: 24 }}>
          <p className="muted">
            这些图片已从业务搜索中移除，百度端删除失败，可在此重试。
          </p>
          {cleanup.data.map((image) => (
            <div className="cleanup-row" key={image.id}>
              <div>
                <strong>{image.sample.code}</strong>
                <p className="error-text">{image.lastError}</p>
              </div>
              <Button onClick={() => retryDelete(image.id)}>重试清理</Button>
            </div>
          ))}
        </Card>
      )}
      <Modal
        title={editing ? "编辑字段" : "添加字段"}
        open={open}
        onCancel={() => !busy && setOpen(false)}
        onOk={save}
        confirmLoading={busy}
      >
        <Form layout="vertical" form={form}>
          <div className="form-grid">
            <Form.Item
              name="label"
              label="字段名称"
              rules={[
                { required: true, whitespace: true, message: "填写名称" },
              ]}
            >
              <Input placeholder="例如 克重" maxLength={60} />
            </Form.Item>
            <Form.Item
              name="key"
              label="字段标识"
              rules={[
                { required: true, message: "填写字段标识" },
                {
                  pattern: /^[a-z][a-z0-9_]{0,39}$/,
                  message: "以小写字母开头，仅支持小写字母、数字和下划线",
                },
              ]}
            >
              <Input disabled={!!editing} placeholder="例如 weight" />
            </Form.Item>
            <Form.Item name="type" label="字段类型">
              <Select
                disabled={!!editing}
                options={[
                  { label: "文本", value: "text" },
                  { label: "数字", value: "number" },
                  { label: "下拉选项", value: "select" },
                ]}
              />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} max={999} />
            </Form.Item>
          </div>
          {fieldType === "select" && (
            <Form.Item
              name="optionsText"
              label="选项（每行一个）"
              rules={[
                {
                  required: true,
                  whitespace: true,
                  message: "至少填写一个选项",
                },
              ]}
            >
              <Input.TextArea rows={4} placeholder={"蓝色\n红色\n绿色"} />
            </Form.Item>
          )}
          <Space size="large">
            <Form.Item name="required" label="必填" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="showInResults"
              label="搜索结果展示"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          colorInfo: "#1677ff",
          borderRadius: 8,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AntApp>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </AntApp>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
