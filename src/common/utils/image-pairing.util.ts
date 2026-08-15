import { BadRequestException } from '@nestjs/common';

// image/imagePublicId phải luôn đi cùng nhau — DB không tách bảng ảnh riêng để tra
// publicId theo url, nếu client chỉ gửi 1 trong 2 thì field còn lại giữ nguyên giá trị cũ
// trong khi ảnh đã đổi, làm giá trị imagePublicId cũ không còn khớp với ảnh hiện tại nữa —
// lần đổi ảnh sau sẽ dọn nhầm/không dọn được đúng ảnh trên Cloudinary. Dùng chung giữa
// Banner và Category (2 model duy nhất có field ảnh đơn + publicId riêng lẻ kiểu này).
export function assertImagePublicIdAligned(
  image: string | null | undefined,
  imagePublicId: string | null | undefined,
  fieldNames: { image: string; imagePublicId: string } = {
    image: 'image',
    imagePublicId: 'imagePublicId',
  },
): void {
  if ((image !== undefined) !== (imagePublicId !== undefined)) {
    throw new BadRequestException(
      `${fieldNames.image} và ${fieldNames.imagePublicId} phải được gửi cùng nhau`,
    );
  }
}

// Biến thể mảng — Product là model duy nhất cho phép nhiều ảnh, dùng chỉ số trong mảng để
// tra publicId theo url (không tách bảng ảnh riêng). 2 mảng lệch độ dài thì lần dọn ảnh đã
// gỡ (cleanupRemovedProductAssets) sẽ tra publicId sai vị trí, có thể xoá nhầm ảnh đang dùng.
export function assertImagesPublicIdsAligned(
  images: string[] | undefined,
  imagePublicIds: string[] | undefined,
): void {
  if (
    images !== undefined &&
    imagePublicIds !== undefined &&
    images.length !== imagePublicIds.length
  ) {
    throw new BadRequestException(
      'images và imagePublicIds phải có cùng số lượng phần tử',
    );
  }
}
