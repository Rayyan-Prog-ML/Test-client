
export const join = (...args) => args.join('/');
export const resolve = (...args) => args.join('/');
export const basename = (path) => path.split('/').pop();
export const dirname = (path) => path.split('/').slice(0, -1).join('/');
export const extname = (path) => {
    const base = basename(path);
    const idx = base.lastIndexOf('.');
    return idx === -1 ? '' : base.substring(idx);
};
export default { join, resolve, basename, dirname, extname };
