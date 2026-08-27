"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPosts = listPosts;
exports.getPost = getPost;
exports.createPost = createPost;
exports.updatePost = updatePost;
exports.deletePost = deletePost;
exports.listPostTypes = listPostTypes;
exports.createPostType = createPostType;
exports.updatePostType = updatePostType;
exports.deletePostType = deletePostType;
const client_1 = __importDefault(require("@/lib/api/client"));
function unwrap(res, fallback) {
    if (res.data.code !== 0 || res.data.data === undefined || res.data.data === null) {
        throw new Error(res.data.message || fallback);
    }
    return res.data.data;
}
/** 将数组参数逗号序列化；空数组/空值过滤掉，保持与后端契约一致。 */
function toParams(query) {
    const params = {};
    if (query.deptId !== undefined && query.deptId !== '' && query.deptId != null) {
        params.deptId = query.deptId;
    }
    if (query.deptIds && query.deptIds.length > 0) {
        params.deptIds = query.deptIds.map(Number).join(',');
    }
    if (query.orgIds && query.orgIds.length > 0) {
        params.orgIds = query.orgIds.map(Number).join(',');
    }
    if (query.postTypeId !== undefined && query.postTypeId !== '' && query.postTypeId != null) {
        params.postTypeId = query.postTypeId;
    }
    if (query.status !== undefined && query.status != null) {
        params.status = query.status;
    }
    return params;
}
async function listPosts(query = {}) {
    const res = await client_1.default.get('/posts', { params: toParams(query) });
    return unwrap(res, '获取岗位列表失败');
}
async function getPost(id) {
    const res = await client_1.default.get(`/posts/${id}`);
    return unwrap(res, '获取岗位失败');
}
async function createPost(body) {
    const res = await client_1.default.post('/posts', body);
    return unwrap(res, '创建岗位失败');
}
async function updatePost(id, body) {
    const res = await client_1.default.put(`/posts/${id}`, body);
    return unwrap(res, '更新岗位失败');
}
async function deletePost(id) {
    const res = await client_1.default.delete(`/posts/${id}`);
    if (res.data.code !== 0)
        throw new Error(res.data.message || '删除岗位失败');
}
/** 岗位类型全量（含禁用）+ referenceCount；status=1 仅启用（下拉用）。 */
async function listPostTypes(status) {
    const res = await client_1.default.get('/post-types', { params: { status } });
    return unwrap(res, '获取岗位类型失败');
}
async function createPostType(body) {
    const res = await client_1.default.post('/post-types', body);
    return unwrap(res, '创建岗位类型失败');
}
async function updatePostType(id, body) {
    const res = await client_1.default.put(`/post-types/${id}`, body);
    return unwrap(res, '更新岗位类型失败');
}
async function deletePostType(id) {
    const res = await client_1.default.delete(`/post-types/${id}`);
    if (res.data.code !== 0)
        throw new Error(res.data.message || '删除岗位类型失败');
}
