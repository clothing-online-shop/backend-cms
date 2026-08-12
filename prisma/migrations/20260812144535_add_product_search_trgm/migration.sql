-- Bật extension pg_trgm (fuzzy/similarity search) và unaccent (bỏ dấu tiếng Việt)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() mặc định STABLE nên không tạo functional index trực tiếp được.
-- Bọc lại thành hàm IMMUTABLE để dùng trong index + query.
-- Gọi unaccent() có schema-qualify (public.unaccent) là bắt buộc: khi Postgres inline
-- hàm SQL 1-dòng này để dùng trong functional index bên dưới, gọi unaccent($1) không
-- qualify sẽ báo "function unaccent(text) does not exist" dù extension đã tạo đúng
-- (đã tự tay verify lỗi này trước khi chốt cách viết).
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent($1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- GIN trigram index cho search theo tên/mô tả sản phẩm và tên thương hiệu
CREATE INDEX products_name_trgm_idx
  ON products USING GIN (immutable_unaccent(name) gin_trgm_ops);
CREATE INDEX products_description_trgm_idx
  ON products USING GIN (immutable_unaccent(coalesce(description, '')) gin_trgm_ops);
CREATE INDEX brands_name_trgm_idx
  ON brands USING GIN (immutable_unaccent(name) gin_trgm_ops);
